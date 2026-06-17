// Per-node blast-radius metrics for the ARCHITECTURE cards. Deterministic (no AI/CLI): derived
// from a component's attached files + the live code-graph import edges. "imports-in" = how many
// DISTINCT external files import into the component; "imports-out" = how many DISTINCT external
// files it depends on. Edges fully inside the component (both endpoints attached) are ignored —
// they're internal cohesion, not blast radius.

export interface BlastMetrics {
  importsIn: number;
  importsOut: number;
}

export function blastMetrics(
  files: Iterable<string>,
  edges: ReadonlyArray<{ fromPath: string; toPath: string }>,
): BlastMetrics {
  const set = files instanceof Set ? (files as Set<string>) : new Set(files);
  if (set.size === 0) return { importsIn: 0, importsOut: 0 };

  const importers = new Set<string>(); // distinct external files importing INTO the component
  const dependencies = new Set<string>(); // distinct external files the component imports
  for (const e of edges) {
    const fromInside = set.has(e.fromPath);
    const toInside = set.has(e.toPath);
    if (toInside && !fromInside) importers.add(e.fromPath);
    if (fromInside && !toInside) dependencies.add(e.toPath);
  }
  return { importsIn: importers.size, importsOut: dependencies.size };
}
