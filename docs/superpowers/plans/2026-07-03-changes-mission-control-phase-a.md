# Changes Mission Control — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the /plan Changes view as an overview-first surface (Mission Control): live activity strip, Activity/Review lenses, episode grouping, importance-first ordering, verb-first file cards with symbols + risk chips, persistent viewed-tracking with auto-invalidation, change-blindness arrival transients, and an upgraded diff detail (word-level emphasis + formatting-noise folding).

**Architecture:** One full `git diff HEAD` pass per refresh replaces the current two-call list (`--name-status`/`--numstat`) and additionally yields per-file symbols (from `@@` hunk-header context) and whitespace-only classification. Pure ordering/grouping/viewed logic lives in small `lib/` modules (unit-tested). The current two-pane component moves nearly verbatim to `diff-detail.tsx`; a new slim `changes-client.tsx` orchestrates overview ⇄ detail and tracks arrivals client-side. Server data flows through the existing RSC props + `router.refresh()` live loop — no new polling.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, react-diff-view 3.3.3 (`markEdits` tokenizer), Bun tests, disk stores under `dataDir()` per plan-loop convention.

## Global Constraints

- Bun for everything (`bun test`, `bunx tsc`); never npm/yarn.
- Browser API routes wrap handlers in `pinned()` from `lib/api-workspace.ts`; never construct the db client directly — `import { db } from "@/lib/db-drizzle"` (server) resolves the pinned workspace.
- No new DB tables; per-workspace state = JSON files under `dataDir()` written with `writeJsonAtomic` (see `lib/touched-files.ts` as the pattern).
- No new dependencies. Deterministic only — no AI calls.
- UI text in English; never the word "Claude" (say "the agent"). Brand: monochrome dark glass + single accent `#ff7a45`; motion is reserved EXCLUSIVELY for "new since you looked" transients.
- TDD for pure logic; UI verified by typecheck + rendering (repo has no DOM test harness — do not add one).
- Small conventional commits (`feat(changes): …`) directly on `main`, one per task.
- Verify against the running repo dev server: `http://localhost:4319` (Turbopack HMR; the /plan Changes view is `/plan?view=changes&ws=1eac6452f826`).
- Baseline before starting: `bun test tests/changes.test.ts tests/scope-contract.test.ts tests/diff-comments.test.ts` → 36 pass.

---

### Task 1: Full-diff parser — symbols + whitespace-only classification (pure)

**Files:**
- Modify: `lib/changes.ts` (add pure functions; do NOT touch `computeChanges` yet)
- Test: `tests/changes.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces (Task 2 + Task 10 rely on these exact names):

```ts
export interface FileDiffMeta {
  status: ChangeStatus;
  oldPath?: string;
  additions: number;
  deletions: number;
  binary: boolean;
  symbols: string[];        // deduped enclosing symbols from @@ headers, first-seen order
  formattingOnly: boolean;  // true when EVERY hunk is whitespace-only (and there is ≥1 hunk)
  hunks: number;
}
export function parseFullDiff(raw: string): Map<string, FileDiffMeta>;
export function symbolFromHunkContext(ctx: string): string | null;
export function isWhitespaceOnlyHunk(removed: string[], added: string[]): boolean;
```

- [ ] **Step 1: Write the failing tests** — append to `tests/changes.test.ts`:

```ts
import { parseFullDiff, symbolFromHunkContext, isWhitespaceOnlyHunk } from "@/lib/changes";

describe("symbolFromHunkContext", () => {
  it("extracts identifiers from ts/js/py/go-style contexts", () => {
    expect(symbolFromHunkContext("export async function approvePlan(opts?: {")).toBe("approvePlan");
    expect(symbolFromHunkContext("export const GET = pinned(async (req: Request) => {")).toBe("GET");
    expect(symbolFromHunkContext("  def compute_changes(now):")).toBe("compute_changes");
    expect(symbolFromHunkContext("class DraftStore {")).toBe("DraftStore");
    expect(symbolFromHunkContext("")).toBeNull();
  });
});

describe("isWhitespaceOnlyHunk", () => {
  it("true when trimmed non-empty lines match as multisets", () => {
    expect(isWhitespaceOnlyHunk(["  a = 1", "b=2"], ["a = 1", "  b=2", ""])).toBe(true);
  });
  it("false when content actually changed", () => {
    expect(isWhitespaceOnlyHunk(["a = 1"], ["a = 2"])).toBe(false);
  });
});

describe("parseFullDiff", () => {
  const RAW = [
    "diff --git a/lib/x.ts b/lib/x.ts",
    "index 111..222 100644",
    "--- a/lib/x.ts",
    "+++ b/lib/x.ts",
    "@@ -10,4 +10,5 @@ export function alpha() {",
    " ctx",
    "-old line",
    "+new line",
    "+added line",
    " ctx",
    "@@ -30,3 +31,3 @@ export function beta() {",
    " ctx",
    "-  spaced",
    "+spaced",
    " ctx",
    "diff --git a/old.ts b/renamed.ts",
    "similarity index 90%",
    "rename from old.ts",
    "rename to renamed.ts",
    "--- a/old.ts",
    "+++ b/renamed.ts",
    "@@ -1,2 +1,2 @@",
    "-a",
    "+b",
    "diff --git a/gone.ts b/gone.ts",
    "deleted file mode 100644",
    "--- a/gone.ts",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-x",
    "-y",
    "diff --git a/img.png b/img.png",
    "index 111..222 100644",
    "Binary files a/img.png and b/img.png differ",
    "",
  ].join("\n");

  it("parses status, counts, symbols, hunks per file", () => {
    const m = parseFullDiff(RAW);
    const x = m.get("lib/x.ts")!;
    expect(x.status).toBe("modified");
    expect(x.additions).toBe(3);
    expect(x.deletions).toBe(2);
    expect(x.symbols).toEqual(["alpha", "beta"]);
    expect(x.hunks).toBe(2);
    expect(x.formattingOnly).toBe(false); // hunk 1 is a real change
  });
  it("handles renames, deletions and binary files", () => {
    expect(m2(RAW).get("renamed.ts")).toMatchObject({ status: "renamed", oldPath: "old.ts" });
    expect(m2(RAW).get("gone.ts")).toMatchObject({ status: "deleted", deletions: 2 });
    expect(m2(RAW).get("img.png")).toMatchObject({ binary: true });
    function m2(r: string) { return parseFullDiff(r); }
  });
  it("flags a file whose every hunk is whitespace-only", () => {
    const ws = parseFullDiff([
      "diff --git a/w.ts b/w.ts",
      "--- a/w.ts",
      "+++ b/w.ts",
      "@@ -1,2 +1,2 @@",
      "-  a=1",
      "+a=1",
      "",
    ].join("\n"));
    expect(ws.get("w.ts")!.formattingOnly).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun test tests/changes.test.ts` → FAIL: `parseFullDiff` is not exported.

- [ ] **Step 3: Implement in `lib/changes.ts`** (below the existing pure parsers):

```ts
// One full `git diff HEAD` pass yields everything the overview needs per file — status, ± counts,
// enclosing symbols (git puts the enclosing declaration after the second @@), whitespace-only
// classification, hunk count. Replaces the separate --name-status/--numstat calls (Task 2).
export interface FileDiffMeta {
  status: ChangeStatus;
  oldPath?: string;
  additions: number;
  deletions: number;
  binary: boolean;
  symbols: string[];
  formattingOnly: boolean;
  hunks: number;
}

// The enclosing-declaration context git appends to @@ headers, reduced to one identifier.
// Handles ts/js (function/const/class/interface/type), python (def), go/rust (func/fn).
export function symbolFromHunkContext(ctx: string): string | null {
  const m = /(?:function|const|let|var|class|interface|type|def|func|fn)\s+([A-Za-z_$][\w$]*)/.exec(ctx);
  if (m) return m[1];
  // Fallback: a bare `name(` method/call context.
  const call = /([A-Za-z_$][\w$]*)\s*\(/.exec(ctx);
  return call ? call[1] : null;
}

// A hunk is whitespace-only when its removed and added lines match as multisets after trimming
// (empty lines dropped) — pure reflow, no content change.
export function isWhitespaceOnlyHunk(removed: string[], added: string[]): boolean {
  const bag = (ls: string[]) => {
    const m = new Map<string, number>();
    for (const l of ls) {
      const t = l.trim();
      if (t) m.set(t, (m.get(t) ?? 0) + 1);
    }
    return m;
  };
  const a = bag(removed), b = bag(added);
  if (a.size !== b.size) return false;
  for (const [k, n] of a) if (b.get(k) !== n) return false;
  return true;
}

export function parseFullDiff(raw: string): Map<string, FileDiffMeta> {
  const out = new Map<string, FileDiffMeta>();
  let cur: FileDiffMeta | null = null;
  let curPath = "";
  let removed: string[] = [];
  let added: string[] = [];
  let sawRealHunk = false;

  const closeHunk = () => {
    if (!cur || (removed.length === 0 && added.length === 0)) return;
    if (!isWhitespaceOnlyHunk(removed, added)) sawRealHunk = true;
    removed = [];
    added = [];
  };
  const closeFile = () => {
    if (!cur) return;
    closeHunk();
    cur.formattingOnly = cur.hunks > 0 && !sawRealHunk;
    out.set(curPath, cur);
    cur = null;
  };

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      closeFile();
      // `diff --git a/<old> b/<new>` — take the b/ path (a/ recovered from rename headers).
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      curPath = m?.[2] ?? "";
      cur = { status: "modified", additions: 0, deletions: 0, binary: false, symbols: [], formattingOnly: false, hunks: 0 };
      sawRealHunk = false;
    } else if (!cur) {
      continue;
    } else if (line.startsWith("rename from ")) {
      cur.oldPath = line.slice("rename from ".length);
      cur.status = "renamed";
    } else if (line.startsWith("rename to ")) {
      curPath = line.slice("rename to ".length);
    } else if (line.startsWith("new file mode")) {
      cur.status = "added";
    } else if (line.startsWith("deleted file mode")) {
      cur.status = "deleted";
    } else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      cur.binary = true;
    } else if (line.startsWith("@@")) {
      closeHunk();
      cur.hunks += 1;
      // `@@ -a,b +c,d @@ <enclosing declaration>`
      const ctx = line.split("@@")[2]?.trim() ?? "";
      const sym = symbolFromHunkContext(ctx);
      if (sym && !cur.symbols.includes(sym)) cur.symbols.push(sym);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      cur.additions += 1;
      added.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      cur.deletions += 1;
      removed.push(line.slice(1));
    }
  }
  closeFile();
  return out;
}
```

- [ ] **Step 4: Run to verify pass** — `bun test tests/changes.test.ts` → all pass (old + new).

- [ ] **Step 5: Commit** — `git add lib/changes.ts tests/changes.test.ts && git commit -m "feat(changes): full-diff parser with symbols + whitespace-only classification"`

---

### Task 2: Rewire `computeChanges` to the single-pass parser

**Files:**
- Modify: `lib/changes.ts` (`computeChanges`, `ChangedFile`, `ChangesResponse`; DELETE `parseNameStatusZ`, `parseNumstatZ`, `FileStatusEntry`, `FileCounts`)
- Modify: `tests/changes.test.ts` (drop the two -z parser suites)
- Modify: `app/plan/page.tsx` + `components/plan/plan-workspace.tsx` (threading — `touched` becomes the full map)

**Interfaces:**
- Produces (Tasks 3–9 rely on these):

```ts
export interface ChangedFile {
  path: string; oldPath?: string; status: ChangeStatus;
  additions: number; deletions: number; lang: string;
  binary?: boolean; tooLarge?: boolean;
  symbols: string[];          // NEW ([] for untracked/binary)
  formattingOnly?: boolean;   // NEW
  inDegree?: number;          // NEW — attached by the server boundary (Task 6)
}
export interface ChangesResponse {
  repo: boolean;
  files: ChangedFile[];
  touched: TouchedMap;        // REPLACES touchedThisSession — full {count,lastAt} map
}
```

- [ ] **Step 1: Update the tests first.** In `tests/changes.test.ts`: delete the `parseNameStatusZ` and `parseNumstatZ` describe blocks and their imports; extend the `untrackedFile` test to assert `symbols: []`. Add:

```ts
describe("computeChanges shape", () => {
  it("returns the touched map (not just keys)", () => {
    const r = computeChanges();
    expect(r).toHaveProperty("touched");
    // every value has count + lastAt when present
    for (const v of Object.values(r.touched)) {
      expect(typeof v.count).toBe("number");
      expect(typeof v.lastAt).toBe("number");
    }
  });
});
```

- [ ] **Step 2: Run** — `bun test tests/changes.test.ts` → FAIL (shape).

- [ ] **Step 3: Rewrite `computeChanges`** — one `git diff HEAD` call, then untracked:

```ts
export function computeChanges(now: number = Date.now()): ChangesResponse {
  const root = repoRoot();
  if (tryGit(["rev-parse", "--is-inside-work-tree"], root) !== "true") {
    return { repo: false, files: [], touched: {} };
  }
  const head = tryGit(["rev-parse", "--verify", "HEAD"], root) !== null ? ["HEAD"] : [];
  const raw = runGit(["diff", "--no-color", "--no-ext-diff", ...head], root, false) ?? "";
  const files: ChangedFile[] = [];
  for (const [path, m] of parseFullDiff(raw)) {
    files.push({
      path,
      oldPath: m.oldPath,
      status: m.status,
      additions: m.additions,
      deletions: m.deletions,
      lang: langFromPath(path),
      binary: m.binary || undefined,
      tooLarge: m.additions + m.deletions > MAX_CHANGED_LINES || undefined,
      symbols: m.symbols,
      formattingOnly: m.formattingOnly || undefined,
    });
  }
  for (const rel of (tryGit(["ls-files", "--others", "--exclude-standard", "-z"], root) ?? "").split("\0").filter(Boolean)) {
    files.push({ ...readUntracked(root, rel), symbols: [] });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { repo: true, files, touched: readTouched(now) };
}
```

`untrackedFile` gains `symbols: []` in its return. Update `app/plan/page.tsx`'s changes mapping to `{ repo: c.repo, files: c.files, touched: c.touched }` and `plan-workspace.tsx`'s prop type to `touched: TouchedMap` — inside, derive `touchedPaths = Object.keys(changes.touched)` where the old string[] was used, and pass the full map through to `ChangesClient` (its prop changes in Task 9; for now convert at the call site with `Object.keys`).

- [ ] **Step 4: Run** — `bun test tests/changes.test.ts && bunx tsc --noEmit -p tsconfig.json` → pass/clean. Then `curl -s -o /dev/null -w "%{http_code}" "http://localhost:4319/plan?view=changes&ws=1eac6452f826"` → 200.

- [ ] **Step 5: Commit** — `git commit -am "feat(changes): single-pass diff list with symbols; touched map in response"`

---

### Task 3: Review ordering — importance-first, tests adjacent, noise last (pure)

**Files:**
- Create: `lib/changes-order.ts`
- Test: `tests/changes-order.test.ts` (create)

**Interfaces:**
- Produces (Task 8 relies on):

```ts
export function isNoisePath(p: string): boolean;
export function reviewScore(f: Pick<ChangedFile, "additions" | "deletions" | "inDegree">): number;
export function testStem(p: string): string | null; // "tests/foo.test.ts" → "foo", else null
export function orderForReview(files: ChangedFile[]): { main: ChangedFile[]; noise: ChangedFile[] };
```

- [ ] **Step 1: Failing tests** — `tests/changes-order.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { isNoisePath, orderForReview, reviewScore, testStem } from "@/lib/changes-order";
import type { ChangedFile } from "@/lib/changes";

const f = (path: string, add = 1, del = 0, inDegree = 0): ChangedFile =>
  ({ path, status: "modified", additions: add, deletions: del, lang: "typescript", symbols: [], inDegree }) as ChangedFile;

describe("isNoisePath", () => {
  it("flags lockfiles, minified, maps, generated dirs", () => {
    for (const p of ["bun.lock", "package-lock.json", "x/y.min.js", "app.js.map", ".next/x.js", "dist/a.js", "node_modules/x.ts"])
      expect(isNoisePath(p)).toBe(true);
    expect(isNoisePath("lib/changes.ts")).toBe(false);
  });
});

describe("testStem", () => {
  it("extracts the subject stem from test paths", () => {
    expect(testStem("tests/changes.test.ts")).toBe("changes");
    expect(testStem("src/foo.spec.tsx")).toBe("foo");
    expect(testStem("lib/changes.ts")).toBeNull();
  });
});

describe("orderForReview", () => {
  it("orders by score desc (size × importer weight), noise last", () => {
    const { main, noise } = orderForReview([
      f("a.ts", 10, 0, 0),
      f("hub.ts", 10, 0, 30),   // same size, heavily imported → first
      f("bun.lock", 500, 0, 0), // noise despite size
    ]);
    expect(main.map((x) => x.path)).toEqual(["hub.ts", "a.ts"]);
    expect(noise.map((x) => x.path)).toEqual(["bun.lock"]);
  });
  it("pulls a test file directly after its subject", () => {
    const { main } = orderForReview([
      f("lib/changes.ts", 50, 0, 10),
      f("lib/other.ts", 40, 0, 8),
      f("tests/changes.test.ts", 5, 0, 0),
    ]);
    expect(main.map((x) => x.path)).toEqual(["lib/changes.ts", "tests/changes.test.ts", "lib/other.ts"]);
  });
  it("reviewScore grows with inDegree", () => {
    expect(reviewScore({ additions: 10, deletions: 0, inDegree: 30 })).toBeGreaterThan(
      reviewScore({ additions: 10, deletions: 0, inDegree: 0 }),
    );
  });
});
```

- [ ] **Step 2: Run** — `bun test tests/changes-order.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `lib/changes-order.ts`:**

```ts
import type { ChangedFile } from "@/lib/changes";

// Review-lens ordering. Research: file position is a review instrument — last-placed files have
// ~64% lower bug-found odds (Fregnan et al.), and alphabetical is the worst common order. Score =
// change size × importer weight (CodeFile.inDegree from the live code graph), so the riskiest
// change gets the reviewer's freshest attention. Pure — inDegree is attached by the caller.

const NOISE = [/(^|\/)bun\.lock$/, /(^|\/)package-lock\.json$/, /(^|\/)yarn\.lock$/, /\.lock$/, /\.min\.\w+$/, /\.map$/, /(^|\/)(\.next|dist|build|node_modules|coverage)\//, /(^|\/)generated\//];

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
  for (const t of tests.sort((a, b) => reviewScore(b) - reviewScore(a))) {
    if (!placed.has(t.path)) main.push(t);
  }
  return { main, noise: noise.sort((a, b) => reviewScore(b) - reviewScore(a)) };
}
```

- [ ] **Step 4: Run** — `bun test tests/changes-order.test.ts` → pass.

- [ ] **Step 5: Commit** — `git add lib/changes-order.ts tests/changes-order.test.ts && git commit -m "feat(changes): importance-first review ordering with tests-adjacent and noise folding"`

---

### Task 4: Episode grouping for the Activity lens (pure)

**Files:**
- Modify: `lib/changes-order.ts`
- Test: `tests/changes-order.test.ts` (extend)

**Interfaces:**
- Produces (Task 8 relies on):

```ts
export interface Episode { key: "now" | "session" | "before"; label: string; files: ChangedFile[] }
export const EPISODE_NOW_MS: number; // 5 * 60_000
export function groupEpisodes(files: ChangedFile[], touched: TouchedMap, now: number): Episode[];
```

- [ ] **Step 1: Failing tests** — append to `tests/changes-order.test.ts`:

```ts
import { groupEpisodes, EPISODE_NOW_MS } from "@/lib/changes-order";
import type { TouchedMap } from "@/lib/touched-files";

describe("groupEpisodes", () => {
  const NOW = 1_000_000_000;
  const touched: TouchedMap = {
    "hot.ts": { count: 3, lastAt: NOW - 30_000 },            // within 5 min → "Now"
    "warm.ts": { count: 1, lastAt: NOW - EPISODE_NOW_MS * 3 } // touched earlier this session
  };
  it("splits into Now / Earlier this session / Before this session", () => {
    const eps = groupEpisodes([f("hot.ts"), f("warm.ts"), f("cold.ts")], touched, NOW);
    expect(eps.map((e) => e.key)).toEqual(["now", "session", "before"]);
    expect(eps[0].files.map((x) => x.path)).toEqual(["hot.ts"]);
    expect(eps[1].files.map((x) => x.path)).toEqual(["warm.ts"]);
    expect(eps[2].files.map((x) => x.path)).toEqual(["cold.ts"]);
  });
  it("orders inside an episode by recency desc and omits empty episodes", () => {
    const t: TouchedMap = {
      "a.ts": { count: 1, lastAt: NOW - 10_000 },
      "b.ts": { count: 1, lastAt: NOW - 5_000 },
    };
    const eps = groupEpisodes([f("a.ts"), f("b.ts")], t, NOW);
    expect(eps).toHaveLength(1);
    expect(eps[0].files.map((x) => x.path)).toEqual(["b.ts", "a.ts"]);
  });
});
```

- [ ] **Step 2: Run** — FAIL (`groupEpisodes` missing).

- [ ] **Step 3: Implement** — append to `lib/changes-order.ts`:

```ts
import type { TouchedMap } from "@/lib/touched-files";

// Activity-lens episodes. Event Segmentation Theory: boundaries where the goal changes are where
// memory anchors form. Deterministic proxy: edit recency from the touched-files store — "Now"
// (≤5 min), "Earlier this session" (touched, older), "Before this session" (uncommitted changes
// the agent never touched). Working memory holds 3–5 chunks; three episodes fit.
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
  const session = files.filter((f) => lastAt(f) !== undefined && (lastAt(f) as number) < now - EPISODE_NOW_MS).sort(byRecency);
  const before = files.filter((f) => lastAt(f) === undefined).sort((a, b) => a.path.localeCompare(b.path));
  return [
    { key: "now" as const, label: "Now", files: nowFiles },
    { key: "session" as const, label: "Earlier this session", files: session },
    { key: "before" as const, label: "Before this session", files: before },
  ].filter((e) => e.files.length > 0);
}
```

- [ ] **Step 4: Run** — `bun test tests/changes-order.test.ts` → pass.

- [ ] **Step 5: Commit** — `git commit -am "feat(changes): episode grouping for the activity lens"`

---

### Task 5: Viewed-files store with auto-invalidation

**Files:**
- Create: `lib/viewed-files.ts`
- Create: `app/api/changes/viewed/route.ts`
- Test: `tests/viewed-files.test.ts` (create)

**Interfaces:**
- Produces (Tasks 6–9 rely on):

```ts
export interface ViewedEntry { viewedAt: number; sig: string }
export type ViewedMap = Record<string, ViewedEntry>;
export function fileSig(f: { status: string; additions: number; deletions: number }): string;
export function readViewedMap(): ViewedMap;
export function setViewed(path: string, sig: string | null): ViewedMap; // null unmarks
export type ViewState = "viewed" | "invalidated" | "unviewed";
export function viewedStates(files: ChangedFile[], viewed: ViewedMap): Record<string, ViewState>;
// Route: POST /api/changes/viewed { path, sig | null } → { viewed: ViewedMap }
```

- [ ] **Step 1: Failing tests** — `tests/viewed-files.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-viewed-"));
import { fileSig, readViewedMap, setViewed, viewedStates } from "@/lib/viewed-files";
import type { ChangedFile } from "@/lib/changes";

const f = (path: string, add = 1, del = 0): ChangedFile =>
  ({ path, status: "modified", additions: add, deletions: del, lang: "typescript", symbols: [] }) as ChangedFile;

beforeEach(() => { for (const p of Object.keys(readViewedMap())) setViewed(p, null); });

describe("viewed store", () => {
  it("marks viewed and reads back", () => {
    setViewed("a.ts", fileSig(f("a.ts", 3, 1)));
    expect(readViewedMap()["a.ts"].sig).toBe("modified:3:1");
  });
  it("viewedStates: valid → viewed; sig drift → invalidated; absent → unviewed", () => {
    setViewed("a.ts", fileSig(f("a.ts", 3, 1)));
    setViewed("b.ts", fileSig(f("b.ts", 1, 0)));
    const states = viewedStates([f("a.ts", 3, 1), f("b.ts", 9, 9), f("c.ts")], readViewedMap());
    expect(states["a.ts"]).toBe("viewed");
    expect(states["b.ts"]).toBe("invalidated"); // agent re-edited after viewing
    expect(states["c.ts"]).toBe("unviewed");
  });
  it("unmarks with null", () => {
    setViewed("a.ts", "modified:1:0");
    setViewed("a.ts", null);
    expect(readViewedMap()["a.ts"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** — FAIL (module missing).

- [ ] **Step 3: Implement `lib/viewed-files.ts`:**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";
import type { ChangedFile } from "@/lib/changes";

// GitHub-style "viewed" marks for the Changes view, with AUTO-INVALIDATION: a mark stores the
// file's change signature at view time; when the agent edits the file again the signature drifts
// and the mark flips to "invalidated" ("changed since you viewed"). Disk file per workspace, same
// pattern as touched-files. ponytail: sig = status:±counts — an edit that reverts counts exactly
// slips through; content-hash the diff if that ever matters.

export interface ViewedEntry { viewedAt: number; sig: string }
export type ViewedMap = Record<string, ViewedEntry>;

export function fileSig(f: { status: string; additions: number; deletions: number }): string {
  return `${f.status}:${f.additions}:${f.deletions}`;
}

function viewedPath(): string {
  return join(dataDir(), "viewed-files.json");
}

export function readViewedMap(): ViewedMap {
  try {
    return JSON.parse(readFileSync(viewedPath(), "utf8")) as ViewedMap;
  } catch {
    return {};
  }
}

export function setViewed(path: string, sig: string | null): ViewedMap {
  const map = readViewedMap();
  if (sig === null) delete map[path];
  else map[path] = { viewedAt: Date.now(), sig };
  writeJsonAtomic(viewedPath(), map);
  return map;
}

export type ViewState = "viewed" | "invalidated" | "unviewed";

export function viewedStates(files: ChangedFile[], viewed: ViewedMap): Record<string, ViewState> {
  const out: Record<string, ViewState> = {};
  for (const f of files) {
    const e = viewed[f.path];
    out[f.path] = !e ? "unviewed" : e.sig === fileSig(f) ? "viewed" : "invalidated";
  }
  return out;
}
```

`app/api/changes/viewed/route.ts`:

```ts
import { pinned } from "@/lib/api-workspace";
import { setViewed } from "@/lib/viewed-files";

export const dynamic = "force-dynamic";

// Toggle a file's viewed mark. sig = the change signature at view time (drives auto-invalidation).
export const POST = pinned(async (req: Request) => {
  const b = (await req.json().catch(() => ({}))) as { path?: string; sig?: string | null };
  if (!b.path) return Response.json({ error: "path required" }, { status: 400 });
  return Response.json({ viewed: setViewed(b.path, b.sig ?? null) });
});
```

- [ ] **Step 4: Run** — `bun test tests/viewed-files.test.ts` → pass; `bunx tsc --noEmit` → clean.

- [ ] **Step 5: Commit** — `git add lib/viewed-files.ts app/api/changes/viewed/route.ts tests/viewed-files.test.ts && git commit -m "feat(changes): viewed-files store with signature auto-invalidation"`

---

### Task 6: Server boundary — attach inDegree + viewed to the Changes payload

**Files:**
- Modify: `app/plan/page.tsx` (changes branch)
- Modify: `app/api/changes/route.ts` (same enrichment for the API consumers)

**Interfaces:**
- Consumes: `computeChanges()` (Task 2), `readViewedMap()` (Task 5).
- Produces: `PlanWorkspace` receives `changes: { repo, files (with inDegree), touched: TouchedMap, viewed: ViewedMap }`.

- [ ] **Step 1: Implement the enrichment in `app/plan/page.tsx`** (replace the `showLiveDiff` computation body):

```ts
const changes = showLiveDiff
  ? await (async () => {
      const c = computeChanges();
      // Importer counts from the live code graph — the "does this break something elsewhere?"
      // signal (CodeFile.inDegree is maintained by the intel daemon).
      const degrees = new Map(
        (await db.query.codeFile.findMany({ columns: { path: true, inDegree: true } })).map((r) => [r.path, r.inDegree]),
      );
      return {
        repo: c.repo,
        files: c.files.map((f) => ({ ...f, inDegree: degrees.get(f.path) ?? 0 })),
        touched: c.touched,
        viewed: readViewedMap(),
      };
    })()
  : null;
```

Mirror the same enrichment in `app/api/changes/route.ts`'s list branch (shared shape; the small duplicate is acceptable at 2 sites).

- [ ] **Step 2: Update prop types** — `plan-workspace.tsx`: `changes?: { repo: boolean; files: ChangedFile[]; touched: TouchedMap; viewed: ViewedMap } | null`; pass all four through to `ChangesClient` (Task 9 consumes them; until then keep `ChangesClient`'s current props satisfied by deriving `touched={Object.keys(changes.touched)}`).

- [ ] **Step 3: Verify** — `bunx tsc --noEmit` clean; `curl -s "http://localhost:4319/api/changes" -H "x-beacon-workspace: 1eac6452f826" | head -c 400` shows `inDegree` and `viewed` keys; the page renders 200.

- [ ] **Step 4: Commit** — `git commit -am "feat(changes): attach importer counts + viewed map to the changes payload"`

---

### Task 7: File card component

**Files:**
- Create: `components/changes/file-card.tsx`

**Interfaces:**
- Consumes: `ChangedFile` (Task 2), `ViewState` (Task 5).
- Produces (Task 8 renders it):

```ts
export function FileCard(props: {
  file: ChangedFile;
  view: ViewState;
  unseen: boolean;      // arrived/updated since the page was opened and not yet opened
  transient: boolean;   // just arrived — brief highlight (the ONLY motion in the view)
  commentCount?: number;
  onOpen: (path: string) => void;
  onToggleViewed: (file: ChangedFile, next: boolean) => void;
}): JSX.Element;
export function verbFor(status: ChangeStatus): string; // added→"Added", modified→"Edited", deleted→"Deleted", renamed→"Renamed"
```

- [ ] **Step 1: Implement** — verb-first left edge (F-pattern), icon+label pairs (dual coding), one hue channel for change kind (reuses the diff green/red/status colors), orange only for comments:

```tsx
"use client";

import { Check, MessageSquarePlus, AlertTriangle } from "lucide-react";
import type { ChangedFile } from "@/lib/changes";
import type { ViewState } from "@/lib/viewed-files";
import type { ChangeStatus } from "@/lib/changes";
import { cn } from "@/lib/utils";

// One changed file, skimmable in a single left-to-right pass: verb + path first (the F-pattern
// left edge is all a scanner reliably sees), then symbols, then magnitude + risk on the right.
// Card = the chunk boundary (Gestalt common region). Motion appears ONLY via `transient`.

export function verbFor(status: ChangeStatus): string {
  return status === "added" ? "Added" : status === "deleted" ? "Deleted" : status === "renamed" ? "Renamed" : "Edited";
}

const VERB_TONE: Record<string, string> = {
  Added: "text-emerald-300",
  Deleted: "text-rose-300",
  Renamed: "text-sky-300",
  Edited: "text-foreground/80",
};

export function FileCard({
  file, view, unseen, transient, commentCount = 0, onOpen, onToggleViewed,
}: {
  file: ChangedFile;
  view: ViewState;
  unseen: boolean;
  transient: boolean;
  commentCount?: number;
  onOpen: (path: string) => void;
  onToggleViewed: (file: ChangedFile, next: boolean) => void;
}) {
  const verb = verbFor(file.status);
  const total = file.additions + file.deletions;
  return (
    <div
      className={cn(
        "group flex w-full items-center gap-2 rounded-lg border border-white/8 bg-card/40 px-3 py-2 text-left transition-colors hover:bg-white/[0.04]",
        transient && "animate-[card-arrive_1.6s_ease-out]",
        view === "viewed" && "opacity-55",
      )}
    >
      {/* Unseen dot — persistent until opened/viewed (change-blindness: transients get missed). */}
      <span className={cn("size-1.5 shrink-0 rounded-full", unseen ? "bg-[#ff7a45]" : "bg-transparent")} />
      <button type="button" onClick={() => onOpen(file.path)} className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className={cn("shrink-0 text-[11px] font-semibold", VERB_TONE[verb])}>{verb}</span>
        <span className="truncate font-mono text-[12px] text-foreground/90" title={file.path}>
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        {file.symbols.length > 0 && (
          <span className="hidden truncate text-[10.5px] text-muted-foreground/70 md:inline">
            ↳ {file.symbols.slice(0, 3).join(", ")}{file.symbols.length > 3 ? "…" : ""}
          </span>
        )}
      </button>
      {file.formattingOnly && (
        <span className="shrink-0 rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">formatting</span>
      )}
      {commentCount > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-[#ff7a45]"><MessageSquarePlus className="size-3" />{commentCount}</span>
      )}
      {(file.inDegree ?? 0) >= 8 && (
        <span
          className="flex shrink-0 items-center gap-0.5 text-[10px] text-amber-300/90"
          title={`${file.inDegree} files import this — check the blast radius`}
        >
          <AlertTriangle className="size-3" />{file.inDegree}
        </span>
      )}
      <span className="shrink-0 text-[11px] tabular-nums">
        <span className="text-emerald-400">+{file.additions}</span> <span className="text-rose-400">−{file.deletions}</span>
      </span>
      {/* Mini magnitude bar: width ∝ share of a 200-line chunk, capped. */}
      <span aria-hidden className="hidden h-1 w-10 shrink-0 overflow-hidden rounded-full bg-white/10 sm:block">
        <span className="block h-full bg-white/35" style={{ width: `${Math.min(100, (total / 200) * 100)}%` }} />
      </span>
      <button
        type="button"
        onClick={() => onToggleViewed(file, view !== "viewed")}
        title={view === "viewed" ? "Viewed — click to unmark" : view === "invalidated" ? "Changed since you viewed it" : "Mark as viewed"}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded border text-[10px] transition-colors",
          view === "viewed"
            ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
            : view === "invalidated"
              ? "border-amber-400/40 bg-amber-500/10 text-amber-300"
              : "border-white/15 text-transparent hover:text-muted-foreground",
        )}
      >
        {view === "invalidated" ? "!" : <Check className="size-3" />}
      </button>
    </div>
  );
}
```

Add the arrival keyframes to `app/globals.css`:

```css
/* Changes view: the one sanctioned motion — a card arriving/updating (change-blindness transient). */
@keyframes card-arrive {
  0% { background-color: rgb(255 122 69 / 0.14); }
  100% { background-color: transparent; }
}
```

- [ ] **Step 2: Verify** — `bunx tsc --noEmit` clean.

- [ ] **Step 3: Commit** — `git add components/changes/file-card.tsx app/globals.css && git commit -m "feat(changes): verb-first file card with viewed, risk and unseen affordances"`

---

### Task 8: Overview component — strip + lenses

**Files:**
- Create: `components/changes/overview.tsx`

**Interfaces:**
- Consumes: `orderForReview`, `groupEpisodes`, `Episode` (Tasks 3–4), `FileCard`, `verbFor` (Task 7), `ViewState` map, `TouchedMap`.
- Produces (Task 9 renders it):

```ts
export type Lens = "activity" | "review";
export function ChangesOverview(props: {
  files: ChangedFile[];
  touched: TouchedMap;
  views: Record<string, ViewState>;
  unseen: Set<string>;
  transients: Set<string>;
  commentCounts: Record<string, number>;
  lens: Lens;
  onLens: (l: Lens) => void;
  onOpen: (path: string) => void;
  onToggleViewed: (file: ChangedFile, next: boolean) => void;
}): JSX.Element;
```

- [ ] **Step 1: Implement `components/changes/overview.tsx`:**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Activity, ListOrdered, GitCompare, ChevronRight } from "lucide-react";
import { FileCard } from "@/components/changes/file-card";
import { groupEpisodes, orderForReview } from "@/lib/changes-order";
import type { ChangedFile } from "@/lib/changes";
import type { TouchedMap } from "@/lib/touched-files";
import type { ViewState } from "@/lib/viewed-files";
import { cn } from "@/lib/utils";

// The glance layer. Overview first, details on demand (Shneiderman): live activity line,
// magnitude vs the ~400-LOC review-attention budget, unseen/viewed progress, then file cards
// under one of two lenses — Activity (episodes by recency) or Review (importance-first).

export type Lens = "activity" | "review";

// Research budget (SmartBear/Cisco): defect detection degrades sharply past ~400 changed lines.
const REVIEW_BUDGET_LINES = 400;

function ago(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export function ChangesOverview({
  files, touched, views, unseen, transients, commentCounts, lens, onLens, onOpen, onToggleViewed,
}: {
  files: ChangedFile[];
  touched: TouchedMap;
  views: Record<string, ViewState>;
  unseen: Set<string>;
  transients: Set<string>;
  commentCounts: Record<string, number>;
  lens: Lens;
  onLens: (l: Lens) => void;
  onOpen: (path: string) => void;
  onToggleViewed: (file: ChangedFile, next: boolean) => void;
}) {
  const now = Date.now();
  const totals = useMemo(
    () => files.reduce((a, f) => ({ add: a.add + f.additions, del: a.del + f.deletions }), { add: 0, del: 0 }),
    [files],
  );
  const totalLines = totals.add + totals.del;
  const budgetPct = Math.min(100, (totalLines / REVIEW_BUDGET_LINES) * 100);
  const latest = useMemo(() => {
    let best: { path: string; lastAt: number } | null = null;
    for (const [path, e] of Object.entries(touched)) if (!best || e.lastAt > best.lastAt) best = { path, lastAt: e.lastAt };
    return best;
  }, [touched]);
  const live = latest && now - latest.lastAt < 60_000;
  const viewedCount = files.filter((f) => views[f.path] === "viewed").length;

  const episodes = useMemo(() => groupEpisodes(files, touched, now), [files, touched, now]);
  const review = useMemo(() => orderForReview(files), [files]);

  const card = (f: ChangedFile) => (
    <FileCard
      key={f.path}
      file={f}
      view={views[f.path] ?? "unviewed"}
      unseen={unseen.has(f.path)}
      transient={transients.has(f.path)}
      commentCount={commentCounts[f.path] ?? 0}
      onOpen={onOpen}
      onToggleViewed={onToggleViewed}
    />
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl min-h-0 flex-col px-4">
      {/* ── Overview strip ── */}
      <div className="shrink-0 space-y-2 border-b border-white/8 py-3">
        <div className="flex items-center gap-2 text-[13px]">
          <span className={cn("relative flex size-2 shrink-0", !live && "opacity-30")}>
            {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#ff7a45] opacity-75" />}
            <span className="relative inline-flex size-2 rounded-full bg-[#ff7a45]" />
          </span>
          {latest ? (
            <span className="min-w-0 truncate">
              <span className="text-muted-foreground">{live ? "Editing" : "Last edited"}</span>{" "}
              <span className="font-mono text-[12px] text-foreground/90">{latest.path}</span>{" "}
              <span className="text-muted-foreground">· {ago(now - latest.lastAt)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">No agent edits this session</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <GitCompare className="size-3.5 shrink-0 text-[#ff7a45]" />
          <span className="tabular-nums">{files.length} files · <span className="text-emerald-400">+{totals.add}</span> <span className="text-rose-400">−{totals.del}</span></span>
          <span aria-hidden className="h-1 w-24 overflow-hidden rounded-full bg-white/10" title={`~${REVIEW_BUDGET_LINES} changed lines is the review-attention budget`}>
            <span className={cn("block h-full", budgetPct >= 100 ? "bg-amber-400/80" : "bg-white/35")} style={{ width: `${budgetPct}%` }} />
          </span>
          {totalLines > REVIEW_BUDGET_LINES && <span className="text-amber-300/90">over the review budget — review soon</span>}
          <span className="ml-auto tabular-nums">{unseen.size > 0 && <span className="text-[#ff7a45]">{unseen.size} unseen · </span>}{viewedCount}/{files.length} viewed</span>
          <div className="flex items-center gap-0.5 rounded-full border border-white/10 p-0.5">
            {(["activity", "review"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onLens(l)}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                  lens === l ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                title={l === "activity" ? "What the agent is doing, newest first" : "Importance-first for a careful pass"}
              >
                {l === "activity" ? <Activity className="size-3" /> : <ListOrdered className="size-3" />}
                {l === "activity" ? "Activity" : "Review"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Cards ── */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3">
        {files.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-muted-foreground">No uncommitted changes yet — the agent's edits land here live.</p>
        ) : lens === "activity" ? (
          episodes.map((e) => (
            <section key={e.key}>
              <h2 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                {e.label} <span className="opacity-60">· {e.files.length}</span>
              </h2>
              <div className="space-y-1">{e.files.map(card)}</div>
            </section>
          ))
        ) : (
          <>
            <div className="space-y-1">{review.main.map(card)}</div>
            {review.noise.length > 0 && <NoiseGroup files={review.noise} render={card} />}
          </>
        )}
      </div>
    </div>
  );
}

// Lockfiles/generated/minified changes, folded by default — they burn skim budget.
function NoiseGroup({ files, render }: { files: ChangedFile[]; render: (f: ChangedFile) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mb-1.5 flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 hover:text-muted-foreground"
      >
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
        Generated & lockfiles · {files.length}
      </button>
      {open && <div className="space-y-1">{files.map(render)}</div>}
    </section>
  );
}
```

- [ ] **Step 2: Verify** — `bunx tsc --noEmit` clean.

- [ ] **Step 3: Commit** — `git add components/changes/overview.tsx && git commit -m "feat(changes): overview strip with activity/review lenses and episode groups"`

---

### Task 9: Orchestrator — overview ⇄ detail, arrivals, viewed wiring

**Files:**
- Create: `components/changes/diff-detail.tsx` (the current `ChangesClient` body moves here nearly verbatim)
- Modify: `components/changes/changes-client.tsx` (becomes the orchestrator)
- Modify: `components/plan/plan-workspace.tsx` (pass the enriched `changes` object)

**Interfaces:**
- Consumes: everything above.
- Produces:

```ts
// diff-detail.tsx — the existing two-pane surface, renamed + given a back affordance:
export function DiffDetail(props: {
  repo: boolean;
  files: ChangedFile[];
  touched: string[];                       // path list (session scope pill)
  contract?: { declaredFiles: string[]; authorizedExtras: string[] } | null;
  initialPath: string | null;              // which file to open on
  onBack: () => void;                      // ← Overview
}): JSX.Element;

// changes-client.tsx — same export name as before (plan-workspace's import is unchanged):
export function ChangesClient(props: {
  repo: boolean;
  files: ChangedFile[];
  touched: TouchedMap;
  viewed: ViewedMap;
  contract?: { declaredFiles: string[]; authorizedExtras: string[] } | null;
}): JSX.Element;
// PlanFilesList stays exported from changes-client.tsx unchanged.
```

- [ ] **Step 1: Extract `DiffDetail`.** Move the ENTIRE current `ChangesClient` function body (sidebar + diff pane + comments + `TreeGroup`/`DiffNote`/`CommentCard`/`ComposerBox` helpers, the `PRISM_CSS` constant, all imports they need) into `components/changes/diff-detail.tsx`, renaming the component `DiffDetail` with the props above. Behavior changes inside it:
  - `touched` prop stays a `string[]` (derive in the orchestrator: `Object.keys(touched)`).
  - Selection starts from `initialPath` (`useState<string | null>(initialPath)`).
  - Add a back button at the far left of the sidebar header (before the collapse toggle):

```tsx
<button type="button" onClick={onBack} title="Back to overview"
  className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-white/[0.06] hover:text-foreground">
  <ArrowLeft className="size-3.5" />
</button>
```

  (`PlanFilesList` stays in `changes-client.tsx`.)

- [ ] **Step 2: Rewrite `changes-client.tsx` as the orchestrator:**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, FileText, GitCompare } from "lucide-react";
import { ChangesOverview, type Lens } from "@/components/changes/overview";
import { DiffDetail } from "@/components/changes/diff-detail";
import { currentTabWs } from "@/lib/tab-ws";
import { fileSig, viewedStates, type ViewedMap } from "@/lib/viewed-files";
import type { ChangedFile } from "@/lib/changes";
import type { TouchedMap } from "@/lib/touched-files";
import type { DiffComment } from "@/lib/diff-comments";

// Mission Control orchestrator: overview (glance layer) ⇄ per-file diff detail. Tracks arrivals
// client-side so a router.refresh() can never mutate the list silently (change blindness): a new
// or re-edited file gets a one-shot transient + a persistent unseen dot until opened or viewed.

export function ChangesClient({
  repo, files, touched, viewed, contract = null,
}: {
  repo: boolean;
  files: ChangedFile[];
  touched: TouchedMap;
  viewed: ViewedMap;
  contract?: { declaredFiles: string[]; authorizedExtras: string[] } | null;
}) {
  const [lens, setLens] = useState<Lens>("activity");
  const [detailPath, setDetailPath] = useState<string | null>(null);
  const [viewedMap, setViewedMap] = useState<ViewedMap>(viewed);
  useEffect(() => setViewedMap(viewed), [viewed]); // server refresh wins

  // Arrival tracking: previous sig per path lives in a ref; a changed/new sig marks the file
  // unseen + transient. Unseen clears on open or viewed; transients clear on a timer.
  const prevSigs = useRef<Map<string, string> | null>(null);
  const [unseen, setUnseen] = useState<Set<string>>(new Set());
  const [transients, setTransients] = useState<Set<string>>(new Set());
  useEffect(() => {
    const sigs = new Map(files.map((f) => [f.path, fileSig(f)]));
    if (prevSigs.current) {
      const fresh: string[] = [];
      for (const [p, s] of sigs) if (prevSigs.current.get(p) !== s) fresh.push(p);
      if (fresh.length) {
        setUnseen((u) => new Set([...u, ...fresh]));
        setTransients(new Set(fresh));
        const t = setTimeout(() => setTransients(new Set()), 1800);
        return () => clearTimeout(t);
      }
    }
    prevSigs.current = sigs;
  }, [files]);
  useEffect(() => {
    prevSigs.current = new Map(files.map((f) => [f.path, fileSig(f)]));
  }, [files]);

  const views = useMemo(() => viewedStates(files, viewedMap), [files, viewedMap]);

  // Comment counts per file for the card chips.
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    const ws = currentTabWs();
    fetch("/api/changes/comment", { cache: "no-store", headers: ws ? { "x-beacon-workspace": ws } : undefined })
      .then((r) => r.json() as Promise<{ comments?: DiffComment[] }>)
      .then((r) => {
        const counts: Record<string, number> = {};
        for (const c of r.comments ?? []) counts[c.file] = (counts[c.file] ?? 0) + 1;
        setCommentCounts(counts);
      })
      .catch(() => {});
  }, [files]);

  const markSeen = (path: string) => setUnseen((u) => { const n = new Set(u); n.delete(path); return n; });

  const toggleViewed = (file: ChangedFile, next: boolean) => {
    const sig = next ? fileSig(file) : null;
    // Optimistic local flip; the server write follows.
    setViewedMap((m) => {
      const n = { ...m };
      if (sig) n[file.path] = { viewedAt: Date.now(), sig };
      else delete n[file.path];
      return n;
    });
    markSeen(file.path);
    const ws = currentTabWs();
    void fetch("/api/changes/viewed", {
      method: "POST",
      headers: { "content-type": "application/json", ...(ws ? { "x-beacon-workspace": ws } : {}) },
      body: JSON.stringify({ path: file.path, sig }),
    }).catch(() => {});
  };

  if (detailPath !== null) {
    return (
      <DiffDetail
        repo={repo}
        files={files}
        touched={Object.keys(touched)}
        contract={contract}
        initialPath={detailPath}
        onBack={() => setDetailPath(null)}
      />
    );
  }
  return (
    <ChangesOverview
      files={files}
      touched={touched}
      views={views}
      unseen={unseen}
      transients={transients}
      commentCounts={commentCounts}
      lens={lens}
      onLens={setLens}
      onOpen={(p) => { markSeen(p); setDetailPath(p); }}
      onToggleViewed={toggleViewed}
    />
  );
}

// (PlanFilesList — unchanged; keep the existing implementation at the bottom of this file.)
```

  NOTE the double `useEffect` on `files`: the first computes arrivals against the PREVIOUS render's sigs and must run before the second overwrites `prevSigs`. Keep them in this order.

- [ ] **Step 3: Update `plan-workspace.tsx`** call site:

```tsx
<ChangesClient repo={changes.repo} files={changes.files} touched={changes.touched} viewed={changes.viewed} contract={contract} />
```

- [ ] **Step 4: Verify** — `bunx tsc --noEmit` clean; `bun test` (full suite) green; page renders 200; then in the browser: overview shows episodes, clicking a card opens the detail, back returns, marking viewed dims the card, and editing any repo file (e.g. `touch`+revert) pulses exactly one transient.

- [ ] **Step 5: Commit** — `git add -A components/changes components/plan/plan-workspace.tsx && git commit -m "feat(changes): mission-control orchestrator — overview ⇄ detail with arrival tracking"`

---

### Task 10: Detail upgrades — word-level emphasis + formatting-hunk folding

**Files:**
- Modify: `components/changes/diff-detail.tsx`

**Interfaces:**
- Consumes: `isWhitespaceOnlyHunk` (Task 1 — pure, reusable client-side), `markEdits` from react-diff-view.

- [ ] **Step 1: Word-level emphasis.** In the `tokens` memo, add the `markEdits` enhancer (read `node_modules/react-diff-view/types/tokenize/index.d.ts` first to confirm the exact option shape in 3.3.3):

```ts
import { markEdits, tokenize } from "react-diff-view";
// inside the memo:
return tokenize(parsed.hunks, {
  highlight: true,
  refractor: refractorAdapter,
  language: active.lang,
  enhancers: [markEdits(parsed.hunks, { type: "block" })],
});
```

- [ ] **Step 2: Fold whitespace-only hunks.** Before rendering, classify each parsed hunk with the Task 1 pure function and render folded ones as a one-line expander:

```tsx
import { isWhitespaceOnlyHunk } from "@/lib/changes";
// helper above the component:
function hunkIsFormattingOnly(h: HunkData): boolean {
  const removed = h.changes.filter((c) => c.type === "delete").map((c) => c.content);
  const added = h.changes.filter((c) => c.type === "insert").map((c) => c.content);
  return (removed.length > 0 || added.length > 0) && isWhitespaceOnlyHunk(removed, added);
}
// in the <Diff> children render, per hunk:
{(hunks) => hunks.map((h) =>
  hunkIsFormattingOnly(h) && !showFormatting.has(h.content) ? (
    <FoldedHunkRow key={h.content} hunk={h} onShow={() => setShowFormatting((s) => new Set([...s, h.content]))} />
  ) : (
    <Hunk key={h.content} hunk={h} />
  ),
)}
```

with state `const [showFormatting, setShowFormatting] = useState<Set<string>>(new Set())` (reset when `activePath` changes) and:

```tsx
function FoldedHunkRow({ hunk, onShow }: { hunk: HunkData; onShow: () => void }) {
  const n = hunk.changes.filter((c) => c.type !== "normal").length;
  return (
    <div className="flex items-center gap-2 border-y border-white/5 bg-white/[0.02] px-4 py-1 text-[11px] text-muted-foreground">
      <span>· formatting-only hunk ({n} lines)</span>
      <button type="button" onClick={onShow} className="rounded-full border border-white/12 px-2 py-0.5 text-[10px] hover:bg-white/[0.06]">show</button>
    </div>
  );
}
```

  NOTE: `FoldedHunkRow` renders OUTSIDE the `<Diff>` table semantics — verify visually; if react-diff-view requires table rows as children, wrap the fold row via its `Decoration` component instead (`import { Decoration } from "react-diff-view"`, render `<Decoration>` with the fold content), which is the library's sanctioned between-hunk slot.

- [ ] **Step 3: Verify** — typecheck clean; in the browser open a file with an intra-line edit → changed words carry the emphasis background; a whitespace-only hunk (create one: re-indent a line in a scratch file) renders folded with a working "show".

- [ ] **Step 4: Run the full suite** — `bun test` → green.

- [ ] **Step 5: Commit** — `git commit -am "feat(changes): word-level diff emphasis + formatting-only hunk folding"`

---

### Task 11: End-to-end verification + registration

**Files:** none (verification), memory update.

- [ ] **Step 1: Full checks** — `bun test && bunx tsc --noEmit -p tsconfig.json && bun run lint` → all green.
- [ ] **Step 2: Live walkthrough on 4319** (`/plan?view=changes&ws=1eac6452f826`): overview lands by default; activity line names the newest touched file; lens toggle re-projects the same files; viewed persists across a reload; editing a file flips its viewed mark to "!" (invalidated); noise files folded in Review lens; detail opens/backs correctly; comments still work end-to-end (add → chip count on card).
- [ ] **Step 3: Memory** — update `changes-view-diff-lib.md` (Mission Control shipped: layers, stores, ordering).
- [ ] **Step 4: Do NOT register the feature yet** — `beacon_feature({action:"done"})` happens ONCE in a single batched call when Phases B and C also ship (ids in the spec header). If phase B/C are deferred beyond this session, register Phase A alone with its id `pdrqxvh8f3zwgc9a9g6dbtjg` and leave B/C pending on the board.
```

## Self-Review

1. **Spec coverage (Phase A):** overview strip ✓ (Task 8), lenses ✓ (8), episodes ✓ (4), importance ordering ✓ (3), verb-first cards + symbols + risk chip ✓ (7), viewed + auto-invalidation ✓ (5), change-blindness transients + unseen ✓ (9), markEdits + formatting folding ✓ (10), single-pass parser ✓ (1–2), tests-adjacent + noise folding ✓ (3), budget bar ✓ (8). Comment-count chip ✓ (9). Gaps: none for Phase A; B/C intentionally separate plans.
2. **Placeholder scan:** none — every step has real code/commands. Two verify-at-implementation notes (markEdits option shape, Decoration wrapper) are explicit instructions to read the installed types, not TBDs.
3. **Type consistency:** `ChangesResponse.touched: TouchedMap` (2) consumed in 6/8/9; `ViewedMap/ViewState/fileSig` (5) consumed in 6/7/9; `Episode`/`orderForReview` (3–4) consumed in 8; `DiffDetail` props (9) match the extraction; `ChangesClient` export name preserved for `plan-workspace.tsx`.
