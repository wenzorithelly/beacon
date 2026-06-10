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
  /** Wrap lane blocks to a new band once a band gets this wide. */
  maxBandW?: number;
}

function keyFor(groupBy: RoadmapGroupBy): (n: RoadmapLayoutNode) => string {
  if (groupBy === "status") return (n) => n.status;
  if (groupBy === "priority") return (n) => String(n.priority);
  return (n) => (n.cluster ?? "").trim() || "—"; // cluster
}

// Lane ordering per dimension: status follows Now→Next→Later, priority 0→3 (critical first),
// cluster is alphabetical with the unset "—" lane last.
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
  const maxBandW = opts.maxBandW ?? colW * 8;

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

  const out = new Map<string, { x: number; y: number }>();
  let bandX = 0;
  let bandY = 0;
  let bandH = 0; // tallest lane in the current band (px)

  for (const k of laneKeys) {
    const feats = byLane.get(k)!;
    // Aspect-targeted column count: pick cols so the lane block comes out ~2× wider than
    // tall (screens are wide — a capped-at-4 lane turned a 50-card Done group into a tower
    // the user had to scroll vertically forever). Row count includes each feature's
    // sub-task stack, since those consume the same column.
    const totalRows = feats.reduce((s, p) => s + 1 + (childrenByParent.get(p.id)?.length ?? 0), 0);
    const cols = Math.max(1, Math.min(maxCols, feats.length, Math.round(Math.sqrt(0.85 * totalRows)) || 1));
    const laneW = cols * colW;

    // Wrap this lane block to a new band if it would overflow the current one.
    if (bandX > 0 && bandX + laneW > maxBandW) {
      bandX = 0;
      bandY += bandH + bandGap;
      bandH = 0;
    }

    const colRows = new Array<number>(cols).fill(0); // row-slots consumed per column
    for (const p of feats) {
      let c = 0;
      for (let i = 1; i < cols; i++) if (colRows[i] < colRows[c]) c = i;
      const x = bandX + c * colW;
      const y = bandY + colRows[c] * rowH;
      out.set(p.id, { x, y });
      const kids = childrenByParent.get(p.id) ?? [];
      kids.forEach((kid, ki) => {
        out.set(kid.id, { x: x + childIndent, y: y + (ki + 1) * rowH });
      });
      colRows[c] += 1 + kids.length;
    }

    const laneRows = colRows.reduce((m, v) => Math.max(m, v), 0);
    bandH = Math.max(bandH, laneRows * rowH);
    bandX += laneW + laneGap;
  }

  return out;
}
