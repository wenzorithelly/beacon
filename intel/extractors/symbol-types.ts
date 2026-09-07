// The one place the CodeSymbolEdge identity is spelled out. Three modules key edges by it — the
// resolver (dedupe), the incremental grapher (snapshot maps) and lib/symbol-graph.ts (the DB diff) —
// and a second spelling in any of them is a silent mismatch between "what changed" and "what was
// written". Pure, so lib/ can import it without pulling tree-sitter into a route bundle.
export function edgeKey(fromId: string, toId: string, relation: string): string {
  return `${fromId}|${toId}|${relation}`;
}
