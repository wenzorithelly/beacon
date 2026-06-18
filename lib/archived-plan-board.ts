import type { FeatureGraph } from "@/lib/feature-design";
import type { MapEdgePayload, MapNodePayload } from "@/components/graph/types";
import { layoutRoadmap, type RoadmapLayoutNode } from "@/lib/roadmap-layout";

// Turn a frozen archived plan's FeatureGraph into the read-only roadmap-board payload
// (MapNodePayload[] + MapEdgePayload[]) the canvas renders in /plan history. Archived
// features are flat, id-less and position-less (unlike the live DRAFT nodes the pending
// plan reads from the db), so we synthesize a stable per-index id and a DETERMINISTIC grid
// layout via layoutRoadmap (grouped by cluster). `dependsOn` titles become DEPENDS edges —
// mirroring persistFeatureDraft, minus the db. Pure + client-safe (type-only imports of the
// db-backed FeatureGraph) so the history view can call it in the browser.
export function archivedFeaturesToBoard(
  graph: FeatureGraph | null | undefined,
): { nodes: MapNodePayload[]; edges: MapEdgePayload[] } {
  const features = graph?.features ?? [];
  if (features.length === 0) return { nodes: [], edges: [] };

  // Stable synthetic id per feature title (index-based — never collides with the cuid2 ids
  // the live db uses, so a stray write that slips the read-only gate hits 0 rows anyway).
  const idByTitle = new Map<string, string>();
  features.forEach((f, i) => {
    const t = f.title.trim();
    if (!idByTitle.has(t)) idByTitle.set(t, `arch-${i}`);
  });
  const idFor = (f: { title: string }, i: number) => idByTitle.get(f.title.trim()) ?? `arch-${i}`;

  // Snapshots carry no x/y — lay them out as a deterministic grid by cluster (pure, testable).
  const layoutInput: RoadmapLayoutNode[] = features.map((f, i) => ({
    id: idFor(f, i),
    parentId: null,
    cluster: f.cluster ?? null,
    status: "PENDING",
    priority: f.priority ?? 2,
    // Height-aware spacing so a long-title archived feature doesn't overlap the card below it.
    title: f.title,
    role: f.role ?? null,
  }));
  const pos = layoutRoadmap(layoutInput, "cluster");

  const nodes: MapNodePayload[] = features.map((f, i) => {
    const id = idFor(f, i);
    const p = pos.get(id) ?? { x: 0, y: 0 };
    return {
      id,
      view: "ROADMAP",
      kind: f.kind ?? "FEATURE",
      cluster: f.cluster ?? null,
      layer: f.layer ?? null,
      title: f.title,
      role: f.role ?? null,
      plain: f.plain ?? null,
      status: "PENDING",
      priority: f.priority ?? 2,
      x: p.x,
      y: p.y,
      source: "DRAFT",
      sourceRef: null,
      parentId: null,
      isCriterion: false,
      files: [],
      bugFlags: [],
    };
  });

  // dependsOn → DEPENDS edges, only between features that exist in THIS snapshot. Skip
  // unresolved titles and self-references (same rules as persistFeatureDraft).
  const edges: MapEdgePayload[] = [];
  features.forEach((f, i) => {
    const fromId = idFor(f, i);
    for (const depRaw of f.dependsOn ?? []) {
      const toId = idByTitle.get(depRaw.trim());
      if (!toId || toId === fromId) continue;
      edges.push({
        id: `arch-edge-${fromId}-${toId}`,
        fromId,
        toId,
        kind: "DEPENDS",
        label: "depends on",
        sourceHandle: null,
        targetHandle: null,
      });
    }
  });

  return { nodes, edges };
}
