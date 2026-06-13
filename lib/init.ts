import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db-drizzle";
import { node, nodeFile, edge, bugFlag } from "@/lib/drizzle/schema";
import { bumpVersion, ingestSnapshot, snapshotSchema } from "@/lib/ingest";
import { normalizeLayer } from "@/lib/layer";
import { setProjectMeta } from "@/lib/project-meta";
import { writeContextFiles } from "@/lib/context-files";
import { layeredLayout } from "@/lib/layered-layout";
import { layoutRoadmap } from "@/lib/roadmap-layout";
import { BOARD_ALGO_VERSIONS, writeBoardLayout } from "@/lib/board-layout-state";

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
  // frontend | backend | fullstack — only meaningful when the repo has a frontend
  // (parse-tolerant; invalid values land as null).
  layer: z.string().nullish(),
  files: z.array(z.string()).default([]),
  depends: z.array(z.string()).default([]),
  // Bugs / things worth investigating found while examining this component's code —
  // recorded as BugFlag rows with by="agent".
  bugs: z.array(z.object({ note: z.string().trim().min(1).max(2000) })).optional(),
});

const roadmapItemSchema = z.object({
  title: z.string().trim().min(1),
  why: z.string().nullish(),
  // Category (cluster) + priority so refresh-created roadmap items aren't dropped on the board
  // without a category, same as feature plans. Accept `cluster` as an alias for `category`.
  category: z.string().nullish(),
  cluster: z.string().nullish(),
  priority: z.number().int().min(0).max(3).nullish(),
  // FEATURE (default) | BUG — lets the survey put a typed bug card on the roadmap
  // when it finds something concrete to fix (parse-tolerant, any case).
  kind: z.string().nullish(),
  // frontend | backend | fullstack — which side of the stack the work lands on.
  layer: z.string().nullish(),
});

export const initInputSchema = z.object({
  overview: z.string().nullish(),
  conventions: z.array(z.string()).default([]),
  // The agent's explicit answer to "does this repo have a frontend?" — gates the layer
  // requirement + UI. Omitted → unresolved (deterministic code-graph fallback applies).
  hasFrontend: z.boolean().nullish(),
  // Top-level dirs whose immediate children are the meaningful Files-canvas groups, e.g.
  // ["frontend","backend/app"]. Where directory grouping STARTS — not every dir. Nullish (not
  // default-[]) so a /beacon-refresh that DOESN'T re-declare them preserves the prior roots
  // instead of wiping them — same omit-preserves contract as hasFrontend.
  classificationRoots: z.array(z.string()).nullish(),
  components: z.array(componentSchema).default([]),
  roadmap: z.array(roadmapItemSchema).default([]),
  // Optional DB extraction in the same call — same shape as the snapshot ingest.
  snapshot: snapshotSchema.optional(),
});

export type InitAnalysis = z.input<typeof initInputSchema>;
type Component = z.infer<typeof componentSchema>;
type RoadmapItem = z.infer<typeof roadmapItemSchema>;

export async function persistArchitecture(components: Component[]): Promise<number> {
  // The INIT replace below cascade-deletes each node's BugFlag rows, but a refresh that
  // recreates the same component (by title) must not lose its flags — least of all one the
  // USER raised. Snapshot them first and re-attach after the recreate.
  const priorInitNodes = await db.query.node.findMany({
    where: (t, { and, eq }) => and(eq(t.view, "ARCHITECTURE"), eq(t.source, "INIT")),
    columns: { title: true },
    with: { bugFlags: true },
  });
  const flagsByTitle = new Map(
    priorInitNodes.filter((n) => n.bugFlags.length).map((n) => [n.title.toLowerCase(), n.bugFlags]),
  );

  // Idempotent: replace a previous init-derived architecture.
  await db.delete(node).where(and(eq(node.view, "ARCHITECTURE"), eq(node.source, "INIT")));

  // Survivors are the non-INIT architecture nodes — created by beacon_describe_feature or by
  // hand on the canvas. A refresh re-describing the same component (by title) must MERGE into
  // the survivor instead of shadowing it with an INIT duplicate: a board built entirely by
  // describe_feature would otherwise double every component on its first /beacon-refresh.
  const survivors = await db.query.node.findMany({
    where: (t, { eq }) => eq(t.view, "ARCHITECTURE"),
    with: { bugFlags: true },
  });
  const survivorByTitle = new Map(survivors.map((n) => [n.title.toLowerCase(), n]));

  const idByTitle = new Map<string, string>();
  const createdTitles = new Set<string>();

  // Layered dependency flow (same layout the /map one-shot applies): foundations left,
  // dependents rightward, domains as contiguous bands. Keyed by title — ids don't exist yet.
  // Positions apply only to NEWLY created nodes; a survivor keeps where the user put it.
  const titleSet = new Set(components.map((c) => c.title));
  const pos = layeredLayout(
    components.map((c) => ({ id: c.title, group: (c.domain ?? "").trim() || "—" })),
    components.flatMap((c) =>
      (c.depends ?? [])
        .filter((d) => titleSet.has(d) && d !== c.title)
        .map((d) => ({ fromId: c.title, toId: d })),
    ),
  );
  writeBoardLayout("architecture", { sig: BOARD_ALGO_VERSIONS.architecture });
  for (const c of components) {
    const key = c.title.toLowerCase();
    const prior = survivorByTitle.get(key);
    if (prior) {
      // Merge semantics mirror upsertArchitectureComponents: fresh analysis wins where it
      // says something, the curated value survives where it doesn't. Source stays MANUAL so
      // the node remains the user's, and its position/status/flags are untouched.
      await db
        .update(node)
        .set({
          cluster: c.domain,
          layer: normalizeLayer(c.layer) ?? prior.layer,
          role: c.role ?? prior.role,
          plain: c.plain ?? prior.plain,
        })
        .where(eq(node.id, prior.id));
      const paths = Array.from(new Set(c.files));
      if (paths.length) {
        await db.delete(nodeFile).where(eq(nodeFile.nodeId, prior.id));
        await db.insert(nodeFile).values(paths.map((path) => ({ nodeId: prior.id, path })));
      }
      idByTitle.set(key, prior.id);
      continue;
    }
    const at = pos.get(c.title) ?? { x: 0, y: 0 };
    const [created] = await db
      .insert(node)
      .values({
        view: "ARCHITECTURE",
        source: "INIT",
        cluster: c.domain,
        layer: normalizeLayer(c.layer),
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
    idByTitle.set(key, created.id);
    createdTitles.add(key);
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

  // Re-attach the snapshotted flags to the RECREATED nodes (a survivor kept its own — the
  // cascade never touched it), then record any newly reported bugs as agent flags — skipping
  // notes already open on the node so a refresh re-reporting the same finding stays idempotent.
  for (const c of components) {
    const key = c.title.toLowerCase();
    const nodeId = idByTitle.get(key);
    if (!nodeId) continue;
    const recreated = createdTitles.has(key);
    const carried = recreated ? (flagsByTitle.get(key) ?? []) : [];
    if (carried.length) {
      await db.insert(bugFlag).values(
        carried.map((f) => ({
          nodeId,
          by: f.by,
          note: f.note,
          resolvedAt: f.resolvedAt,
          createdAt: f.createdAt,
        })),
      );
    }
    const liveOpen = recreated ? [] : (survivorByTitle.get(key)?.bugFlags ?? []);
    const openNotes = new Set(
      [...carried, ...liveOpen].filter((f) => !f.resolvedAt).map((f) => f.note),
    );
    for (const b of c.bugs ?? []) {
      if (openNotes.has(b.note)) continue;
      await db.insert(bugFlag).values({ nodeId, by: "agent", note: b.note });
    }
  }

  return components.length;
}

export async function persistRoadmap(roadmap: RoadmapItem[]): Promise<number> {
  await db.delete(node).where(and(eq(node.view, "ROADMAP"), eq(node.source, "INIT")));
  // Organized by default: lay the items out in labeled theme lanes (the same grouping the /map
  // one-shot would apply) and record the sig so the first load doesn't re-arrange them again.
  const items = roadmap.map((r, i) => ({
    id: String(i),
    parentId: null,
    cluster: r.category ?? r.cluster ?? null,
    status: "PENDING",
    priority: r.priority ?? 2,
  }));
  const pos = layoutRoadmap(items, "cluster");
  for (let i = 0; i < roadmap.length; i++) {
    const r = roadmap[i];
    const p = pos.get(String(i)) ?? { x: 0, y: 0 };
    await db
      .insert(node)
      .values({
        view: "ROADMAP",
        source: "INIT",
        kind: r.kind?.trim().toUpperCase() === "BUG" ? "BUG" : "FEATURE",
        layer: normalizeLayer(r.layer),
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
  writeBoardLayout("roadmap", { sig: BOARD_ALGO_VERSIONS.roadmap, arrangedBy: "cluster" });
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
    hasFrontend: parsed.hasFrontend, // undefined/null → leave unresolved
    classificationRoots: parsed.classificationRoots ?? undefined, // omit/null → keep prior roots
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
