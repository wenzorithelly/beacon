// Collision-free placement for newly-created roadmap nodes. All the creation paths used to drop
// nodes at fixed offsets (parent.x + i*240, i*300, …) with no awareness of what's already on the
// board, so a new feature/sub-task could land on top of an existing card. This nudges a new node
// straight DOWN until it's clear, PRESERVING every existing position (no global re-layout that
// would undo the user's manual drags). Pure — unit-tested, shared by lib/map-ops + lib/feature-design.

export interface Pos {
  x: number;
  y: number;
}

// Minimum separation (px) below which two cards count as overlapping. Kept SMALLER than the grid
// steps the layouts use (≥240 horizontal) so a normal row isn't flagged — only a card that
// genuinely landed on/near another one.
const MIN_W = 200;
const MIN_H = 150;

function overlaps(a: Pos, b: Pos): boolean {
  return Math.abs(a.x - b.x) < MIN_W && Math.abs(a.y - b.y) < MIN_H;
}

/** Place a new node at `desired`, nudging it down (preserving x) until it clears every existing
 *  node. Existing positions are never moved. */
export function placeWithoutOverlap(existing: Pos[], desired: Pos): Pos {
  const pos = { x: desired.x, y: desired.y };
  for (let i = 0; i < 100 && existing.some((e) => overlaps(pos, e)); i++) {
    pos.y += MIN_H;
  }
  return pos;
}

export interface PlaceInGroupOptions {
  colW?: number;
  rowH?: number;
  maxCols?: number;
  /** Vertical gap before a brand-new group's region, below the whole board. */
  bandGap?: number;
}

/** Place a new node INSIDE its group's region: snap to the group's masonry columns and drop
 *  into the shortest one (regions grow downward, never sideways into a neighbour). A node with
 *  no group siblings starts a new region below everything on the board. Existing positions are
 *  never moved; `placeWithoutOverlap` is the board-wide safety net (a foreign card sitting in
 *  the chosen slot pushes us further down, not on top of it). */
export function placeInGroup(
  groupMembers: Pos[],
  allNodes: Pos[],
  opts: PlaceInGroupOptions = {},
): Pos {
  const colW = opts.colW ?? 320;
  const rowH = opts.rowH ?? 150;
  const maxCols = opts.maxCols ?? 4;
  const bandGap = opts.bandGap ?? 90;

  if (groupMembers.length === 0) {
    if (allNodes.length === 0) return { x: 0, y: 0 };
    const maxY = Math.max(...allNodes.map((n) => n.y));
    return placeWithoutOverlap(allNodes, { x: 0, y: maxY + rowH + bandGap });
  }

  const minX = Math.min(...groupMembers.map((m) => m.x));
  const groupTop = Math.min(...groupMembers.map((m) => m.y));
  // Column count: what the group already spans, or enough for a square-ish block — the same
  // shape layoutRoadmap's masonry produces — capped so regions never sprawl horizontally.
  const ks = groupMembers.map((m) => Math.max(0, Math.round((m.x - minX) / colW)));
  const numCols = Math.min(
    maxCols,
    Math.max(Math.max(...ks) + 1, Math.ceil(Math.sqrt(groupMembers.length + 1))),
  );
  // Bottom-most occupied y per column; an empty column reads as one slot above the group top.
  const bottoms = new Array<number>(numCols).fill(groupTop - rowH);
  groupMembers.forEach((m, i) => {
    const k = Math.min(ks[i], numCols - 1);
    bottoms[k] = Math.max(bottoms[k], m.y);
  });
  let best = 0;
  for (let k = 1; k < numCols; k++) if (bottoms[k] < bottoms[best]) best = k;
  return placeWithoutOverlap(allNodes, { x: minX + best * colW, y: bottoms[best] + rowH });
}
