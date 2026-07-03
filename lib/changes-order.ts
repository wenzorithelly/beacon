import type { ChangedFile } from "@/lib/changes";
import type { TouchedMap } from "@/lib/touched-files";

// Pure projection logic for the Changes overview's two lenses.
//
// Review lens: file position is a review instrument — last-placed files have ~64% lower
// bug-found odds (Fregnan et al.), and alphabetical is the worst common order. Score =
// change size × importer weight (CodeFile.inDegree from the live code graph), so the riskiest
// change gets the reviewer's freshest attention. Tests ride next to the code they test;
// lockfiles/generated noise folds to the bottom.
//
// Activity lens: Event Segmentation Theory — boundaries where the goal changes are where memory
// anchors form. Deterministic proxy: edit recency from the touched-files store.

const NOISE = [
  /(^|\/)bun\.lock$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /\.lock$/,
  /\.min\.\w+$/,
  /\.map$/,
  /(^|\/)(\.next|dist|build|node_modules|coverage)\//,
  /(^|\/)generated\//,
];

export function isNoisePath(p: string): boolean {
  return NOISE.some((r) => r.test(p));
}

export function reviewScore(f: Pick<ChangedFile, "additions" | "deletions" | "inDegree">): number {
  return (f.additions + f.deletions) * (1 + Math.log2(1 + (f.inDegree ?? 0)));
}

// "tests/changes.test.ts" → "changes"; anything not *.test.* / *.spec.* → null.
export function testStem(p: string): string | null {
  const base = p.split("/").pop() ?? "";
  const m = /^(.+?)\.(test|spec)\.\w+$/.exec(base);
  return m ? m[1] : null;
}

export function orderForReview(files: ChangedFile[]): { main: ChangedFile[]; noise: ChangedFile[] } {
  const noise = files.filter((f) => isNoisePath(f.path));
  const rest = files.filter((f) => !isNoisePath(f.path));
  const tests = rest.filter((f) => testStem(f.path) !== null);
  const subjects = rest.filter((f) => testStem(f.path) === null).sort((a, b) => reviewScore(b) - reviewScore(a));

  // Tests ride directly after their subject (matched by filename stem); unmatched tests keep
  // their own score order at the end of the main list.
  const main: ChangedFile[] = [];
  const placed = new Set<string>();
  for (const s of subjects) {
    main.push(s);
    const stem = (s.path.split("/").pop() ?? "").replace(/\.\w+$/, "");
    for (const t of tests) {
      if (!placed.has(t.path) && testStem(t.path) === stem) {
        main.push(t);
        placed.add(t.path);
      }
    }
  }
  for (const t of [...tests].sort((a, b) => reviewScore(b) - reviewScore(a))) {
    if (!placed.has(t.path)) main.push(t);
  }
  return { main, noise: [...noise].sort((a, b) => reviewScore(b) - reviewScore(a)) };
}

// ── Activity-lens episodes ───────────────────────────────────────────────────
// "Now" (edited ≤5 min ago), "Earlier this session" (touched, older), "Before this session"
// (uncommitted changes the agent never touched). Working memory holds 3–5 chunks; three fit.
export const EPISODE_NOW_MS = 5 * 60_000;

export interface Episode {
  key: "now" | "session" | "before";
  label: string;
  files: ChangedFile[];
}

export function groupEpisodes(files: ChangedFile[], touched: TouchedMap, now: number): Episode[] {
  const lastAt = (f: ChangedFile) => touched[f.path]?.lastAt ?? (f.oldPath ? touched[f.oldPath]?.lastAt : undefined);
  const byRecency = (a: ChangedFile, b: ChangedFile) => (lastAt(b) ?? 0) - (lastAt(a) ?? 0);
  const nowFiles = files.filter((f) => (lastAt(f) ?? 0) >= now - EPISODE_NOW_MS).sort(byRecency);
  const session = files
    .filter((f) => lastAt(f) !== undefined && (lastAt(f) as number) < now - EPISODE_NOW_MS)
    .sort(byRecency);
  const before = files.filter((f) => lastAt(f) === undefined).sort((a, b) => a.path.localeCompare(b.path));
  return [
    { key: "now" as const, label: "Now", files: nowFiles },
    { key: "session" as const, label: "Earlier this session", files: session },
    { key: "before" as const, label: "Before this session", files: before },
  ].filter((e) => e.files.length > 0);
}
