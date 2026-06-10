import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db, type DB } from "@/lib/db-drizzle";
import { node, edge } from "@/lib/drizzle/schema";
import { forceLayoutRoadmap } from "@/lib/roadmap-force-layout";

// Feature draft schema: top-level roadmap nodes the terminal session pushes via
// `beacon_propose_plan`. Persisted as DRAFT Nodes (view=ROADMAP, source=DRAFT) so they
// render on the /map roadmap canvas as a draft layer, parallel to the /db draft.

type Prisma = DB;

export const featureItemSchema = z
        .object({
          title: z.string().trim().min(1),
          role: z.string().nullish(),
          plain: z.string().nullish(),
          cluster: z.string().nullish(),
          // The agent + UI both call the category "category", and "domain" is the adjacent word
          // it reaches for — accept all three and normalize to `cluster` below so a plan written
          // with `category` (the natural choice) isn't dropped on the floor.
          category: z.string().nullish(),
          domain: z.string().nullish(),
          // Any number is accepted and CLAMPED to 0..3 below — the agent's scale (often 1..4 or
          // 1..5) shouldn't drop the feature. Kept nullish for parse tolerance; the propose-plan
          // flow REQUIRES it via validateProposedFeatures (lib/feature-rules) before persisting.
          priority: z.number().nullish(),
          // FEATURE (default) | BUG — a typed bug card on the roadmap. Parse-tolerant
          // (any case); anything that isn't "bug" lands as FEATURE.
          kind: z.string().nullish(),
          // Titles of other features in THIS plan that must ship first. Resolved into DEPENDS
          // edges so the board shows the dependency chain instead of disconnected cards. It's a
          // transport array only — never stored as a DB scalar list (it becomes Edge rows).
          dependsOn: z.array(z.string()).nullish(),
        })
        // Normalize the category aliases (`category`/`domain` → `cluster`) and clamp priority into
        // Beacon's P0..P3 range so a slightly-off plan still lands on the board instead of being
        // dropped wholesale.
        .transform(({ category, domain, priority, kind, ...f }) => ({
          ...f,
          cluster: f.cluster ?? category ?? domain ?? null,
          priority: priority == null ? null : Math.max(0, Math.min(3, Math.round(priority))),
          kind: kind?.trim().toUpperCase() === "BUG" ? ("BUG" as const) : ("FEATURE" as const),
        }));

export const featureSchema = z.object({
  features: z.array(featureItemSchema).default([]),
});
export type FeatureGraph = z.infer<typeof featureSchema>;

export async function clearFeatureDraft(prisma: Prisma = db) {
  await prisma.delete(node).where(and(eq(node.source, "DRAFT"), eq(node.view, "ROADMAP")));
}

export async function persistFeatureDraft(graph: FeatureGraph, prisma: Prisma = db) {
  const g = featureSchema.parse(graph);
  await clearFeatureDraft(prisma);

  // Place the proposal below any existing roadmap cards so it doesn't overlap them.
  const top = await prisma.query.node.findFirst({
    where: (t, { eq }) => eq(t.view, "ROADMAP"),
    orderBy: (t, { desc }) => desc(t.y),
  });
  const baseY = (top?.y ?? 0) + 200;

  // Lay the draft out as an organic 2D graph (d3-force) so dependency-linked features cluster and
  // independent ones spread across the width — instead of a blind horizontal row. dependsOn titles
  // become edges; the layout keys off titles since the node ids don't exist yet.
  const titleSet = new Set(g.features.map((f) => f.title.trim()));
  const layoutNodes = g.features.map((f) => ({ id: f.title.trim() }));
  const layoutEdges = g.features.flatMap((f) =>
    (f.dependsOn ?? [])
      .map((d) => d.trim())
      .filter((d) => titleSet.has(d) && d !== f.title.trim())
      .map((d) => ({ fromId: f.title.trim(), toId: d })),
  );
  const pos = forceLayoutRoadmap(layoutNodes, layoutEdges);

  const idByTitle = new Map<string, string>();
  for (const f of g.features) {
    const p = pos.get(f.title.trim()) ?? { x: 0, y: 0 };
    const [created] = await prisma
      .insert(node)
      .values({
        view: "ROADMAP",
        source: "DRAFT",
        status: "PENDING",
        kind: f.kind,
        title: f.title,
        role: f.role ?? null,
        plain: f.plain ?? null,
        cluster: f.cluster ?? null,
        priority: f.priority ?? 2,
        x: p.x,
        y: p.y + baseY,
      })
      .returning();
    idByTitle.set(f.title.trim(), created.id);
  }

  // Auto-connect: turn each feature's `dependsOn` titles into DEPENDS edges so the proposal
  // renders as a connected dependency chain on /plan and /map instead of loose cards. Skip
  // unresolved titles + self-references; idempotent on the unique [fromId,toId,kind]. These
  // edges cascade-delete with the draft nodes on the next clearFeatureDraft, so re-proposing
  // is clean with no orphan edges.
  for (const f of g.features) {
    const fromId = idByTitle.get(f.title.trim());
    if (!fromId || !f.dependsOn) continue;
    for (const depTitle of f.dependsOn) {
      const toId = idByTitle.get(depTitle.trim());
      if (!toId || toId === fromId) continue;
      const exists = await prisma.query.edge.findFirst({
        where: (t, { and, eq }) =>
          and(eq(t.fromId, fromId), eq(t.toId, toId), eq(t.kind, "DEPENDS")),
      });
      if (!exists) await prisma.insert(edge).values({ fromId, toId, kind: "DEPENDS" });
    }
  }
}

export async function getFeatureDraft(prisma: Prisma = db): Promise<FeatureGraph> {
  const nodes = await prisma.query.node.findMany({
    where: (t, { and, eq }) => and(eq(t.source, "DRAFT"), eq(t.view, "ROADMAP")),
    orderBy: (t, { asc }) => asc(t.createdAt),
  });
  // Reconstruct each feature's dependsOn (by title) from the DEPENDS edges among the draft
  // nodes, so a re-read / re-propose round-trips the dependency chain.
  const ids = nodes.map((n) => n.id);
  const edges = ids.length
    ? await prisma.query.edge.findMany({
        where: (t, { and, eq }) =>
          and(eq(t.kind, "DEPENDS"), inArray(t.fromId, ids), inArray(t.toId, ids)),
      })
    : [];
  const titleById = new Map(nodes.map((n) => [n.id, n.title]));
  const depsByFrom = new Map<string, string[]>();
  for (const e of edges) {
    const toTitle = titleById.get(e.toId);
    if (!toTitle) continue;
    const arr = depsByFrom.get(e.fromId) ?? [];
    arr.push(toTitle);
    depsByFrom.set(e.fromId, arr);
  }
  return {
    features: nodes.map((n) => ({
      title: n.title,
      role: n.role,
      plain: n.plain,
      cluster: n.cluster,
      priority: n.priority,
      kind: n.kind === "BUG" ? ("BUG" as const) : ("FEATURE" as const),
      dependsOn: depsByFrom.get(n.id),
    })),
  };
}
