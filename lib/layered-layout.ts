// Deterministic Sugiyama-lite for the ARCHITECTURE board. The empirical graph-drawing result
// this encodes: edge crossings are the #1 readability killer, and layered left→right layouts
// win comprehension studies. Layers = dependency depth (foundations at layer 0, left; each
// dependent one column right of everything it depends on), so the board reads as a flow.
// Domains form contiguous horizontal BANDS (every layer stacks its nodes in the same global
// domain order with reserved per-domain rows), which keeps the per-domain group regions
// disjoint. Within a (domain, layer) cell, nodes order by the barycenter of their dependency
// rows — the classic crossing-reduction heuristic. Hand-rolled (~140 lines) instead of
// dagre/elkjs: the graphs are small (<100 nodes) and the repo avoids layout deps.

export interface LayeredNode {
  id: string;
  /** Domain/category — drives the horizontal banding. */
  group: string;
}

/** `fromId` DEPENDS ON `toId` (the Edge.kind=DEPENDS direction). */
export interface LayeredEdge {
  fromId: string;
  toId: string;
}

export const LAYER_W = 360;
export const ROW_H = 150;
/** Vertical gap between bands of domain blocks (room for the region header). */
export const BAND_GAP = 170;
/** Horizontal gap between adjacent domain blocks. */
export const BLOCK_GAP_X = 140;
/** Wrap domain blocks to a new band past this width. */
export const MAX_BAND_W = 8 * LAYER_W;

/** Drop back-edges via DFS over id-sorted adjacency so the layering terminates. Deterministic:
 *  the same graph always keeps/drops the same edges regardless of input order. */
export function breakCycles(nodes: LayeredNode[], edges: LayeredEdge[]): LayeredEdge[] {
  const ids = nodes.map((n) => n.id).sort();
  const adj = new Map<string, LayeredEdge[]>(ids.map((id) => [id, []]));
  for (const e of [...edges].sort((a, b) => a.fromId.localeCompare(b.fromId) || a.toId.localeCompare(b.toId))) {
    adj.get(e.fromId)?.push(e);
  }
  const state = new Map<string, "visiting" | "done">();
  const kept: LayeredEdge[] = [];
  const visit = (id: string) => {
    state.set(id, "visiting");
    for (const e of adj.get(id) ?? []) {
      const s = state.get(e.toId);
      if (s === "visiting") continue; // back-edge → drop
      kept.push(e);
      if (s !== "done") visit(e.toId);
    }
    state.set(id, "done");
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  return kept;
}

/** Longest-path layering on a DAG: a node with no dependencies sits at layer 0; every other
 *  node sits one past its deepest dependency. */
export function assignLayers(nodes: LayeredNode[], dag: LayeredEdge[]): Map<string, number> {
  const deps = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of dag) deps.get(e.fromId)?.push(e.toId);
  const layers = new Map<string, number>();
  const depth = (id: string): number => {
    const known = layers.get(id);
    if (known !== undefined) return known;
    layers.set(id, 0); // breaks residual cycles defensively
    const ds = deps.get(id) ?? [];
    const l = ds.length ? 1 + Math.max(...ds.map(depth)) : 0;
    layers.set(id, l);
    return l;
  };
  for (const n of nodes) depth(n.id);
  return layers;
}

/** Full layout: Map<id, {x,y}>. Each domain is a BLOCK with the dependency flow inside it
 *  (layers left→right, normalized to the domain's own min depth); blocks pack left→right
 *  across the screen and wrap into bands — so a shallow graph spreads WIDE instead of
 *  stacking domains into a vertical tower. A layer-cell with many nodes wraps into extra
 *  sub-columns (capped rows) so a flat all-layer-0 domain still comes out square-ish. */
export function layeredLayout(
  nodes: LayeredNode[],
  edges: LayeredEdge[],
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map();
  const dag = breakCycles(nodes, edges);
  const layers = assignLayers(nodes, dag);
  const deps = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of dag) deps.get(e.fromId)?.push(e.toId);

  // Domain blocks, alphabetical with "—" last.
  const domains = Array.from(new Set(nodes.map((n) => n.group)));
  const named = domains.filter((d) => d !== "—").sort();
  const domainOrder = domains.includes("—") ? [...named, "—"] : named;

  // ── Per-domain block layout in LOCAL coordinates ──
  interface Block {
    d: string;
    w: number;
    h: number;
    local: Map<string, { x: number; y: number }>;
  }
  const blocks: Block[] = [];
  for (const d of domainOrder) {
    const members = nodes.filter((n) => n.group === d);
    const minL = Math.min(...members.map((n) => layers.get(n.id) ?? 0));
    const maxL = Math.max(...members.map((n) => layers.get(n.id) ?? 0));
    const local = new Map<string, { x: number; y: number }>();
    const rowOf = new Map<string, number>(); // local row of already-placed nodes (barycenter)
    let xOff = 0;
    let maxRows = 1;
    for (let l = minL; l <= maxL; l++) {
      const cell = members.filter((n) => layers.get(n.id) === l);
      if (!cell.length) continue; // empty layer consumes no width
      const bary = (n: LayeredNode): number => {
        const rows = (deps.get(n.id) ?? []).map((t) => rowOf.get(t)).filter((r): r is number => r !== undefined);
        return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : Number.POSITIVE_INFINITY;
      };
      cell.sort((a, b) => bary(a) - bary(b) || a.id.localeCompare(b.id));
      // Cap a cell's height so a flat cell (everything at layer 0) wraps into sub-columns
      // instead of one tall stack — square-ish beats tower.
      const rowsCap = Math.max(1, Math.ceil(Math.sqrt(cell.length * 2)));
      cell.forEach((n, i) => {
        const sub = Math.floor(i / rowsCap);
        const row = i % rowsCap;
        rowOf.set(n.id, row);
        local.set(n.id, { x: xOff + sub * LAYER_W, y: row * ROW_H });
        maxRows = Math.max(maxRows, row + 1);
      });
      xOff += Math.ceil(cell.length / rowsCap) * LAYER_W;
    }
    blocks.push({ d, w: xOff, h: maxRows * ROW_H, local });
  }

  // ── Pack blocks left→right, wrapping into bands (room for the region header in the gaps) ──
  const pos = new Map<string, { x: number; y: number }>();
  let blockX = 0;
  let bandTop = 0;
  let bandMaxH = 0;
  for (const b of blocks) {
    if (blockX > 0 && blockX + b.w > MAX_BAND_W) {
      bandTop += bandMaxH + BAND_GAP;
      blockX = 0;
      bandMaxH = 0;
    }
    for (const [id, p] of b.local) pos.set(id, { x: blockX + p.x, y: bandTop + p.y });
    bandMaxH = Math.max(bandMaxH, b.h);
    blockX += b.w + BLOCK_GAP_X;
  }
  return pos;
}
