import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db-drizzle";
import { node, nodeFile, edge } from "@/lib/drizzle/schema";
import { bumpVersion, ingestSnapshot, snapshotSchema } from "@/lib/ingest";
import { setProjectMeta } from "@/lib/project-meta";
import { writeContextFiles } from "@/lib/context-files";
import { layoutArchitectureByDomain } from "@/lib/architecture-layout";
import { forceLayoutRoadmap } from "@/lib/roadmap-force-layout";

// Beacon's repo-mapping (formerly the `beacon init` CLI). The CLI used to spawn
// a separate Claude/Anthropic process to read the repo and produce structured
// JSON; that's now done by the user's OWN Claude Code session via the
// `/beacon-init` skill, which POSTs the analysis here. Same persistence path —
// only the source of the analysis changed (cheaper, full project context).

const componentSchema = z.object({
  title: z.string().trim().min(1),
  domain: z.string().trim().min(1),
  role: z.string().nullish(),
  plain: z.string().nullish(),
  files: z.array(z.string()).default([]),
  depends: z.array(z.string()).default([]),
});

const roadmapItemSchema = z.object({
  title: z.string().trim().min(1),
  why: z.string().nullish(),
  // Category (cluster) + priority so refresh-created roadmap items aren't dropped on the board
  // without a category, same as feature plans. Accept `cluster` as an alias for `category`.
  category: z.string().nullish(),
  cluster: z.string().nullish(),
  priority: z.number().int().min(0).max(3).nullish(),
});

export const initInputSchema = z.object({
  overview: z.string().nullish(),
  conventions: z.array(z.string()).default([]),
  components: z.array(componentSchema).default([]),
  roadmap: z.array(roadmapItemSchema).default([]),
  // Optional DB extraction in the same call — same shape as the snapshot ingest.
  snapshot: snapshotSchema.optional(),
});

export type InitAnalysis = z.input<typeof initInputSchema>;
type Component = z.infer<typeof componentSchema>;
type RoadmapItem = z.infer<typeof roadmapItemSchema>;

async function persistArchitecture(components: Component[]): Promise<number> {
  // Idempotent: replace a previous init-derived architecture.
  await db.delete(node).where(and(eq(node.view, "ARCHITECTURE"), eq(node.source, "INIT")));

  const idByTitle = new Map<string, string>();

  // Group by domain into a wrapped grid so related components sit together (vs one long row).
  const wrapped = components.map((c) => ({ domain: c.domain, c }));
  const pos = layoutArchitectureByDomain(wrapped);
  for (const w of wrapped) {
    const c = w.c;
    const at = pos.get(w) ?? { x: 0, y: 0 };
    const [created] = await db
      .insert(node)
      .values({
        view: "ARCHITECTURE",
        source: "INIT",
        cluster: c.domain,
        title: c.title,
        role: c.role ?? null,
        plain: c.plain ?? null,
        status: "KEEP",
        x: at.x,
        y: at.y,
      })
      .returning();
    const paths = Array.from(new Set(c.files));
    if (paths.length) {
      await db.insert(nodeFile).values(paths.map((path) => ({ nodeId: created.id, path })));
    }
    idByTitle.set(c.title.toLowerCase(), created.id);
  }

  for (const c of components) {
    const fromId = idByTitle.get(c.title.toLowerCase());
    for (const dep of c.depends ?? []) {
      const toId = idByTitle.get(dep.toLowerCase());
      if (fromId && toId && fromId !== toId) {
        await db
          .insert(edge)
          .values({ fromId, toId, kind: "DEPENDS" })
          .catch(() => {});
      }
    }
  }
  return components.length;
}

async function persistRoadmap(roadmap: RoadmapItem[]): Promise<number> {
  await db.delete(node).where(and(eq(node.view, "ROADMAP"), eq(node.source, "INIT")));
  // Roadmap items carry no dependency edges, so the force layout spreads them organically across
  // the board's width instead of one long horizontal row off the screen.
  const pos = forceLayoutRoadmap(
    roadmap.map((_, i) => ({ id: String(i) })),
    [],
  );
  for (let i = 0; i < roadmap.length; i++) {
    const r = roadmap[i];
    const p = pos.get(String(i)) ?? { x: 0, y: 0 };
    const [created] = await db
      .insert(node)
      .values({
        view: "ROADMAP",
        source: "INIT",
        title: r.title,
        plain: r.why ?? null,
        cluster: r.category ?? r.cluster ?? null,
        priority: r.priority ?? 2,
        status: "PENDING",
        x: p.x,
        y: p.y,
      })
      .returning();
  }
  return roadmap.length;
}

// Collapse ROADMAP features that share a title (case-insensitive) to ONE node. Re-proposing a
// feature that already exists used to leave a second node next to the original (a DONE original +
// a re-approved PENDING copy). Keep the richest node — DONE status > most attached files > has a
// category — fold the others' files in and backfill any missing category/priority/description
// from them, then delete the rest. Runs on /beacon-refresh so the map self-heals. DRAFT nodes
// (a plan under review) are left untouched.
const STATUS_RANK: Record<string, number> = { DONE: 3, IN_PROGRESS: 2, PARTIAL: 2, BLOCKED: 1, PENDING: 0 };

export async function dedupeRoadmapByTitle(): Promise<number> {
  const nodes = await db.query.node.findMany({
    where: (t, { and, eq, ne }) => and(eq(t.view, "ROADMAP"), ne(t.source, "DRAFT")),
    with: { files: { columns: { path: true } } },
    orderBy: (t, { asc }) => asc(t.createdAt), // ties → keep the oldest
  });
  const groups = new Map<string, typeof nodes>();
  for (const n of nodes) {
    const key = n.title.trim().toLowerCase();
    const arr = groups.get(key);
    if (arr) arr.push(n);
    else groups.set(key, [n]);
  }

  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const score = (n: (typeof nodes)[number]) =>
      (STATUS_RANK[n.status] ?? 0) * 1000 + n.files.length * 10 + (n.cluster ? 1 : 0);
    const keeper = group.reduce((best, n) => (score(n) > score(best) ? n : best), group[0]);
    const dropped = group.filter((n) => n.id !== keeper.id);

    const have = new Set(keeper.files.map((f) => f.path));
    const addPaths: string[] = [];
    let cluster = keeper.cluster;
    let plain = keeper.plain;
    let role = keeper.role;
    let priority = keeper.priority;
    for (const d of dropped) {
      for (const f of d.files) if (!have.has(f.path)) { have.add(f.path); addPaths.push(f.path); }
      cluster ??= d.cluster;
      plain ??= d.plain;
      role ??= d.role;
      if (d.priority != null && (priority == null || d.priority < priority)) priority = d.priority; // keep the most urgent
    }
    await db.update(node).set({ cluster, plain, role, priority }).where(eq(node.id, keeper.id));
    if (addPaths.length) {
      await db.insert(nodeFile).values(addPaths.map((path) => ({ nodeId: keeper.id, path })));
    }
    await db.delete(node).where(inArray(node.id, dropped.map((d) => d.id)));
    removed += dropped.length;
  }
  return removed;
}

/**
 * Persist a /beacon-init analysis prepared by the user's Claude Code session.
 * Side-effects: architecture nodes/edges, roadmap fronts, project meta, AGENTS.md
 * regen, sync version bump. No AI calls happen here.
 */
export async function runInitFromAnalysis(input: unknown): Promise<{
  components: number;
  roadmap: number;
  deduped: number;
  tables: number;
  endpoints: number;
  context: string[];
}> {
  const parsed = initInputSchema.parse(input);

  let tables = 0;
  let endpoints = 0;
  if (parsed.snapshot) {
    try {
      const r = await ingestSnapshot(parsed.snapshot);
      tables = r.tables;
      endpoints = r.endpoints;
    } catch (e) {
      console.error("[init] snapshot ingest failed:", e instanceof Error ? e.message : e);
    }
  }

  const components = await persistArchitecture(parsed.components);
  const roadmap = await persistRoadmap(parsed.roadmap);
  // Refresh self-heals duplicate features: collapse any same-title roadmap nodes (e.g. a DONE
  // feature + a re-approved PENDING copy) into one.
  const deduped = await dedupeRoadmapByTitle();
  await setProjectMeta({
    overview: parsed.overview ?? null,
    conventions: parsed.conventions,
  });

  let context: string[] = [];
  try {
    context = await writeContextFiles();
  } catch (e) {
    console.error("[init] context files failed:", e instanceof Error ? e.message : e);
  }

  await bumpVersion();
  return { components, roadmap, deduped, tables, endpoints, context };
}
