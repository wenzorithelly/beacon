import { extractImports } from "@/intel/extractors/imports";
import type { SourceFile } from "@/intel/extractors/files";

// Architecture drift from the module dependency graph: circular dependencies and
// "god" modules (very high fan-in/out). These are objective signals — AI agents in
// particular tend to introduce locally-sensible but globally-inconsistent cycles.

export interface DriftReport {
  cycles: string[][];
  godModules: { path: string; fanIn: number; fanOut: number }[];
}

// Tarjan's strongly-connected-components → any SCC of size > 1 is a dependency cycle.
function findCycles(adj: Map<string, string[]>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const strongconnect = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) sccs.push(comp.reverse());
    }
  };

  for (const v of adj.keys()) if (!idx.has(v)) strongconnect(v);
  return sccs;
}

export function analyzeDrift(files: SourceFile[]): DriftReport {
  const imports = extractImports(files);
  const adj = new Map<string, string[]>();
  const fanIn = new Map<string, number>();
  for (const i of imports) {
    adj.set(i.path, i.internal);
    for (const t of i.internal) fanIn.set(t, (fanIn.get(t) ?? 0) + 1);
  }

  const cycles = findCycles(adj)
    .sort((a, b) => b.length - a.length)
    .slice(0, 10);

  const godModules = imports
    .map((i) => ({ path: i.path, fanIn: fanIn.get(i.path) ?? 0, fanOut: i.internal.length }))
    .filter((m) => m.fanIn >= 6 || m.fanOut >= 12)
    .sort((a, b) => b.fanIn + b.fanOut - (a.fanIn + a.fanOut))
    .slice(0, 12);

  return { cycles, godModules };
}
