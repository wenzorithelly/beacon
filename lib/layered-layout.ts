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
/** Extra vertical gap between domain bands (beyond the row grid). */
export const BAND_GAP = 60;

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

/** Full layout: Map<id, {x,y}>. */
export function layeredLayout(
  nodes: LayeredNode[],
  edges: LayeredEdge[],
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map();
  const dag = breakCycles(nodes, edges);
  const layers = assignLayers(nodes, dag);
  const maxLayer = Math.max(...nodes.map((n) => layers.get(n.id) ?? 0));

  // Global domain order: alphabetical, unset ("—") last — identical in every layer, which is
  // what makes the bands contiguous and the region boxes disjoint.
  const domains = Array.from(new Set(nodes.map((n) => n.group)));
  const named = domains.filter((d) => d !== "—").sort();
  const domainOrder = domains.includes("—") ? [...named, "—"] : named;

  // Reserve each domain enough rows for its tallest layer-cell.
  const cellCount = new Map<string, number>(); // `${domain}|${layer}` → n
  for (const n of nodes) {
    const key = `${n.group}|${layers.get(n.id)}`;
    cellCount.set(key, (cellCount.get(key) ?? 0) + 1);
  }
  const bandRows = new Map<string, number>();
  for (const d of domainOrder) {
    let rows = 1;
    for (let l = 0; l <= maxLayer; l++) rows = Math.max(rows, cellCount.get(`${d}|${l}`) ?? 0);
    bandRows.set(d, rows);
  }
  const bandTop = new Map<string, number>(); // y px of the band's first row
  let topPx = 0;
  for (const d of domainOrder) {
    bandTop.set(d, topPx);
    topPx += bandRows.get(d)! * ROW_H + BAND_GAP;
  }

  // Place layer by layer (left→right). Within a (domain, layer) cell, order by the barycenter
  // of already-placed dependency rows (crossing reduction), tie-break by id.
  const deps = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of dag) deps.get(e.fromId)?.push(e.toId);
  const rowOf = new Map<string, number>(); // absolute row index already assigned
  const pos = new Map<string, { x: number; y: number }>();
  for (let l = 0; l <= maxLayer; l++) {
    const inLayer = nodes.filter((n) => layers.get(n.id) === l);
    for (const d of domainOrder) {
      const cell = inLayer.filter((n) => n.group === d);
      const bary = (n: LayeredNode): number => {
        const rows = (deps.get(n.id) ?? []).map((t) => rowOf.get(t)).filter((r): r is number => r !== undefined);
        return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : Number.POSITIVE_INFINITY;
      };
      cell.sort((a, b) => bary(a) - bary(b) || a.id.localeCompare(b.id));
      cell.forEach((n, i) => {
        rowOf.set(n.id, bandTop.get(d)! / ROW_H + i);
        pos.set(n.id, { x: l * LAYER_W, y: bandTop.get(d)! + i * ROW_H });
      });
    }
  }
  return pos;
}
