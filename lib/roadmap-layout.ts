// Deterministic group-by layout for the ROADMAP canvas. Powers the on-demand "Group by"
// action: bucket top-level features into labeled lanes (by cluster / status / priority) and
// lay each lane out as a COMPACT GRID BLOCK — features masonry-packed into a few columns so a
// large group stays a tidy rectangle instead of one long vertical strip. Lane blocks flow
// left→right and wrap into new bands. Each feature's sub-tasks stack directly beneath it
// inside its grid cell, so the CONTAINS (parent→child) lines stay short and readable.
//
// Pure (no DB, no React) so it can be unit-tested and reused by the client. Returns a Map
// keyed by node id — the caller applies the positions to React Flow state + persists them.

import { STATUS_LANE_ORDER } from "@/lib/constants";
import { flowBlocksIntoBands } from "@/lib/band-flow";

export type RoadmapGroupBy = "cluster" | "status" | "priority";

// Layout dimensions. ROADMAP_COL_W is the width of one card column; a lane block is a small
// integer number of these wide. Children indent inside their parent's column.
export const ROADMAP_COL_W = 320;
export const ROADMAP_ROW_H = 150;
export const ROADMAP_CHILD_INDENT = 24;

export interface RoadmapLayoutNode {
  id: string;
  parentId: string | null;
  cluster: string | null;
  status: string;
  priority: number;
}

export interface RoadmapLayoutOptions {
  colW?: number;
  rowH?: number;
  /** Horizontal indent of a sub-task relative to its parent feature. */
  childIndent?: number;
  /** Gap between adjacent lane blocks. */
  laneGap?: number;
  /** Vertical gap between bands when lane blocks wrap to a new row. */
  bandGap?: number;
  /** Max columns a single lane block packs into before it just grows taller. */
  maxCols?: number;
  /** Never wrap narrower than this (a floor under the viewport-derived band width). */
  minBandW?: number;
  /** Viewport aspect (width / height) so the board is sized to the reviewer's screen. */
  viewportAspect?: number;
}

function keyFor(groupBy: RoadmapGroupBy): (n: RoadmapLayoutNode) => string {
  if (groupBy === "status") return (n) => n.status;
  if (groupBy === "priority") return (n) => String(n.priority);
  return (n) => (n.cluster ?? "").trim() || "—"; // cluster
}

// Lane ordering per dimension: status follows Now→Next→Later, priority 0→3 (critical first),
// cluster is alphabetical with "—" last.
function laneOrderFor(
  groupBy: RoadmapGroupBy,
  parents: RoadmapLayoutNode[],
  key: (n: RoadmapLayoutNode) => string,
): string[] {
  if (groupBy === "status") return [...STATUS_LANE_ORDER];
  if (groupBy === "priority") return ["0", "1", "2", "3"];
  const keys = Array.from(new Set(parents.map(key)));
  const named = keys.filter((k) => k !== "—").sort();
  return keys.includes("—") ? [...named, "—"] : named;
}

export function layoutRoadmap(
  nodes: RoadmapLayoutNode[],
  groupBy: RoadmapGroupBy,
  opts: RoadmapLayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const colW = opts.colW ?? ROADMAP_COL_W;
  const rowH = opts.rowH ?? ROADMAP_ROW_H;
  const childIndent = opts.childIndent ?? ROADMAP_CHILD_INDENT;
  const laneGap = opts.laneGap ?? 56;
  const bandGap = opts.bandGap ?? 110;
  const maxCols = opts.maxCols ?? 10;
  const minBandW = opts.minBandW ?? colW * 3;

  const ids = new Set(nodes.map((n) => n.id));
  // A node is top-level if it has no parent, or its parent isn't on this board (orphan).
  const isTopLevel = (n: RoadmapLayoutNode) => !n.parentId || !ids.has(n.parentId);

  const parents = nodes.filter(isTopLevel);
  const childrenByParent = new Map<string, RoadmapLayoutNode[]>();
  for (const n of nodes) {
    if (isTopLevel(n)) continue;
    const arr = childrenByParent.get(n.parentId!);
    if (arr) arr.push(n);
    else childrenByParent.set(n.parentId!, [n]);
  }

  const key = keyFor(groupBy);
  const byLane = new Map<string, RoadmapLayoutNode[]>();
  for (const p of parents) {
    const k = key(p);
    const arr = byLane.get(k);
    if (arr) arr.push(p);
    else byLane.set(k, [p]);
  }
  const laneKeys = laneOrderFor(groupBy, parents, key).filter((k) => byLane.has(k));

  // Phase 1 — lay each lane block out in LOCAL coords (features masonry-packed, sub-tasks stacked
  // beneath their parent) and record its size. Aspect-target the column count so a big lane stays
  // a tidy rectangle (a capped-at-4 lane turned a 50-card Done group into an endless tower).
  interface LaneBlock {
    id: string;
    w: number;
    h: number;
    local: Map<string, { x: number; y: number }>;
  }
  const laneBlocks: LaneBlock[] = [];
  for (const k of laneKeys) {
    const feats = byLane.get(k)!;
    const totalRows = feats.reduce((s, p) => s + 1 + (childrenByParent.get(p.id)?.length ?? 0), 0);
    const cols = Math.max(1, Math.min(maxCols, feats.length, Math.round(Math.sqrt(0.85 * totalRows)) || 1));
    const colRows = new Array<number>(cols).fill(0); // row-slots consumed per column
    const local = new Map<string, { x: number; y: number }>();
    for (const p of feats) {
      let c = 0;
      for (let i = 1; i < cols; i++) if (colRows[i] < colRows[c]) c = i;
      const x = c * colW;
      const y = colRows[c] * rowH;
      local.set(p.id, { x, y });
      const kids = childrenByParent.get(p.id) ?? [];
      kids.forEach((kid, ki) => {
        local.set(kid.id, { x: x + childIndent, y: y + (ki + 1) * rowH });
      });
      colRows[c] += 1 + kids.length;
    }
    const laneRows = colRows.reduce((m, v) => Math.max(m, v), 0);
    laneBlocks.push({ id: k, w: cols * colW, h: laneRows * rowH, local });
  }

  // Phase 2 — flow the lane blocks into viewport-sized bands (shared with the db + architecture
  // boards), then offset each node by its block origin.
  const origins = flowBlocksIntoBands(
    laneBlocks.map((b) => ({ id: b.id, w: b.w, h: b.h })),
    { gapX: laneGap, gapY: bandGap, viewportAspect: opts.viewportAspect, minBandW, aspectSlack: 1.5 },
  );
  const out = new Map<string, { x: number; y: number }>();
  for (const block of laneBlocks) {
    const origin = origins.get(block.id)!;
    for (const [id, p] of block.local) out.set(id, { x: origin.x + p.x, y: origin.y + p.y });
  }
  return out;
}
