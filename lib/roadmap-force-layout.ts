// Organic 2D layout for the ROADMAP canvas — a synchronous d3-force simulation (the same physics
// family that powers the Files canvas and Obsidian's graph view). A layered/columnar layout is
// wrong for a roadmap because most features depend on NOTHING, so they all collapse into one tall
// strip. Force layout instead spreads independent features across the WIDTH of the board and pulls
// dependency-linked features into tight clusters, keeping edges short and readable.
//
// Deterministic: nodes are sorted by id (stable d3 phyllotaxis seeding) and the simulation's
// randomness is a seeded PRNG, so the same graph always yields the same layout — which lets the
// caller gate re-layout on a structural signature and compare positions without spurious churn.
//
// Pure (only depends on d3-force) so it can be unit-tested and run on the server.

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";

export interface ForceLayoutNode {
  id: string;
  /** Sub-tasks (parentId set) are pulled tight to their parent with a short link. */
  parentId?: string | null;
}

/** A DEPENDS edge: `fromId` depends on `toId`. Direction is irrelevant to the physics. */
export interface ForceLayoutEdge {
  fromId: string;
  toId: string;
}

export interface ForceLayoutOptions {
  /** Resting length of a dependency link (center-to-center). */
  linkDistance?: number;
  /** Repulsion between every pair of cards (negative = repel). */
  charge?: number;
  /** Collision radius so wide cards don't overlap. */
  collideRadius?: number;
  /** Simulation iterations. */
  ticks?: number;
}

// Defaults tuned for the ~256×110px feature cards. Repulsion is kept GENTLE so collision (not
// charge) is the binding constraint — that packs cards into a compact cloud that just clears
// overlap, instead of flinging them across an empty canvas. collideRadius ≈ half a card width +
// margin so neighbours touch but don't overlap; linkDistance keeps connected cards adjacent.
const DEFAULTS = {
  linkDistance: 210,
  charge: -450,
  collideRadius: 132,
  ticks: 500,
};

// mulberry32 — a tiny deterministic PRNG so the simulation is reproducible (no Math.random).
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SimNode extends SimulationNodeDatum {
  id: string;
}

export function forceLayoutRoadmap(
  nodes: ForceLayoutNode[],
  edges: ForceLayoutEdge[],
  opts: ForceLayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const linkDistance = opts.linkDistance ?? DEFAULTS.linkDistance;
  const charge = opts.charge ?? DEFAULTS.charge;
  const collideRadius = opts.collideRadius ?? DEFAULTS.collideRadius;
  const ticks = opts.ticks ?? DEFAULTS.ticks;

  // Sort by id → stable phyllotaxis seeding → deterministic output.
  const ordered = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ids = new Set(ordered.map((n) => n.id));
  const simNodes: SimNode[] = ordered.map((n) => ({ id: n.id }));

  const links: { source: string; target: string }[] = [];
  for (const e of edges) {
    if (e.fromId !== e.toId && ids.has(e.fromId) && ids.has(e.toId)) {
      links.push({ source: e.fromId, target: e.toId });
    }
  }
  // CONTAINS: keep a sub-task hugging its parent with a shorter, stronger link.
  for (const n of ordered) {
    if (n.parentId && ids.has(n.parentId)) links.push({ source: n.id, target: n.parentId });
  }

  const sim = forceSimulation(simNodes)
    .randomSource(seededRandom(0x9e3779b9))
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string }>(links)
        .id((n) => n.id)
        .distance(linkDistance)
        .strength(0.6),
    )
    .force("charge", forceManyBody<SimNode>().strength(charge).distanceMax(1200))
    .force("collide", forceCollide<SimNode>().radius(collideRadius).strength(1))
    .force("center", forceCenter(0, 0).strength(0.08))
    .stop();

  for (let i = 0; i < ticks; i++) sim.tick();

  const out = new Map<string, { x: number; y: number }>();
  for (const n of simNodes) {
    out.set(n.id, { x: Math.round(n.x ?? 0), y: Math.round(n.y ?? 0) });
  }
  return out;
}
