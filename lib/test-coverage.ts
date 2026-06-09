// Deterministic "is this code tested?" signal from the import graph — pure + client-safe
// (no fs, no AI, no CLI). Drives the "Test-Coverage Flags" overlay: a source file is flagged
// "untested" when NO test file imports it. AI-generated code is notoriously under-tested, so
// surfacing the gap on the files canvas is a concrete, zero-cost quality cue.

// A path is a test file if it lives under a tests/ dir OR ends in .test./.spec.<ext>.
const TEST_RE = /(^|\/)tests?\/|\.(test|spec)\.[jt]sx?$/i;

export function isTestFile(path: string): boolean {
  return TEST_RE.test(path);
}

// The set of (non-test) files that no test file imports — i.e. untested code. A file counts as
// covered the moment any test file has an import edge to it.
export function untestedFiles(
  files: ReadonlyArray<string>,
  edges: ReadonlyArray<{ from: string; to: string }>,
): Set<string> {
  const coveredTargets = new Set<string>();
  for (const e of edges) if (isTestFile(e.from)) coveredTargets.add(e.to);
  const out = new Set<string>();
  for (const f of files) if (!isTestFile(f) && !coveredTargets.has(f)) out.add(f);
  return out;
}
