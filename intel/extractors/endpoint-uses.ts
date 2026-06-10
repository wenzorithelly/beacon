// Deterministic endpoint→table links — NO AI. For each Next route file, scan the file plus
// its import radius (depth ≤ 2 in the live code graph) for Drizzle table-variable usage:
//   db.query.<var> / .from(<var>)  → read
//   insert|update|delete(<var>)    → write
// `tableVars` (drizzle var → SQL table name) comes from the model extractor, so a hit maps
// straight onto a board table. A route with no hits stays unlinked — honestly DB-free.

export interface EndpointUsesInput {
  /** Route files (base-relative POSIX, e.g. app/api/notes/route.ts). */
  routeFiles: string[];
  /** Code-graph import edges (from → to, same path space). */
  edges: { from: string; to: string }[];
  /** File contents lookup; null when unreadable. */
  content: (path: string) => string | null;
  /** Drizzle table variable → SQL table name. */
  tableVars: Record<string, string>;
}

const RADIUS = 2; // route → lib → lib is where the db calls live; deeper drags in the world
const MAX_FILES = 25; // per route — keeps a hub import from ballooning the scan

export function deriveEndpointUses(
  input: EndpointUsesInput,
): Map<string, { table: string; access: string }[]> {
  const vars = Object.keys(input.tableVars);
  const out = new Map<string, { table: string; access: string }[]>();
  if (!vars.length) {
    for (const f of input.routeFiles) out.set(f, []);
    return out;
  }
  const adjacency = new Map<string, string[]>();
  for (const e of input.edges) {
    const list = adjacency.get(e.from) ?? [];
    list.push(e.to);
    adjacency.set(e.from, list);
  }
  const readRe = new Map(
    vars.map((v) => [v, new RegExp(`(?:query\\.${v}\\b|\\.from\\(\\s*${v}\\b)`)]),
  );
  const writeRe = new Map(
    vars.map((v) => [v, new RegExp(`(?:insert|update|delete)\\(\\s*${v}\\b`)]),
  );

  for (const route of input.routeFiles) {
    // BFS the import radius.
    const seen = new Set<string>([route]);
    let frontier = [route];
    for (let d = 0; d < RADIUS && seen.size < MAX_FILES; d++) {
      const next: string[] = [];
      for (const f of frontier) {
        for (const to of adjacency.get(f) ?? []) {
          if (seen.has(to) || seen.size >= MAX_FILES) continue;
          seen.add(to);
          next.push(to);
        }
      }
      frontier = next;
    }
    const reads = new Set<string>();
    const writes = new Set<string>();
    for (const f of seen) {
      const src = input.content(f);
      if (!src) continue;
      for (const v of vars) {
        if (!reads.has(v) && readRe.get(v)!.test(src)) reads.add(v);
        if (!writes.has(v) && writeRe.get(v)!.test(src)) writes.add(v);
      }
    }
    const uses: { table: string; access: string }[] = [];
    for (const v of vars) {
      const r = reads.has(v);
      const w = writes.has(v);
      if (!r && !w) continue;
      uses.push({ table: input.tableVars[v], access: r && w ? "read-write" : w ? "write" : "read" });
    }
    out.set(route, uses);
  }
  return out;
}
