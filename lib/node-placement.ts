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
