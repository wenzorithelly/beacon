import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { repoRoot } from "@/lib/project";
import { readTouched, type TouchedMap } from "@/lib/touched-files";
import {
  langFromPath,
  parseFullDiff,
  realLineCount,
  untrackedFile,
  MAX_CHANGED_LINES,
  type ChangedFile,
  type FileDiff,
} from "@/lib/diff-shared";

// The live "Changes" surface reads the git working tree — as the agent executes an approved
// plan its edits become uncommitted changes, and `git diff` IS "what's being changed". Nothing
// is persisted: this recomputes from git on demand. ONE full `git diff HEAD` pass per refresh
// yields the file list AND the overview signals (per-file symbols from @@ hunk headers,
// whitespace-only classification, ± counts); each file's raw per-file diff is still read lazily
// when it's selected. The PURE parsers live in lib/diff-shared.ts (client-safe, unit-tested);
// this module holds the impure shells and re-exports the shared names for existing importers.

export * from "@/lib/diff-shared";

export interface ChangesResponse {
  repo: boolean;
  files: ChangedFile[];
  // Full per-file recency map (edit count + lastAt) — drives the activity lens episodes and the
  // live overview strip, not just a "this session" filter.
  touched: TouchedMap;
}

// Files larger than this aren't read into a diff (open in editor instead).
const MAX_FILE_BYTES = 512 * 1024;

function runGit(args: string[], root: string, trim: boolean): string | null {
  try {
    const out = execFileSync("git", args, {
      cwd: root,
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    return trim ? out.trim() : out;
  } catch {
    return null;
  }
}
const tryGit = (args: string[], root: string) => runGit(args, root, true);

function readUntracked(root: string, rel: string): ChangedFile {
  const base: ChangedFile = { path: rel, status: "added", additions: 0, deletions: 0, lang: langFromPath(rel), symbols: [] };
  try {
    if (statSync(join(root, rel)).size > MAX_FILE_BYTES) return { ...base, tooLarge: true };
    const buf = readFileSync(join(root, rel));
    if (buf.includes(0)) return { ...base, binary: true };
    return untrackedFile(rel, buf.toString("utf8"));
  } catch {
    return base; // vanished / unreadable — list it, no diff
  }
}

// The ref the working tree is diffed against: the plan's review BASELINE when one is passed and
// still resolvable (so mid-plan commits stay visible in review), else HEAD, else nothing (fresh
// repo with no commits).
function diffBase(root: string, base: string | null | undefined): string[] {
  if (base && tryGit(["cat-file", "-e", `${base}^{commit}`], root) !== null) return [base];
  return tryGit(["rev-parse", "--verify", "HEAD"], root) !== null ? ["HEAD"] : [];
}

// Impure shell: compute the working-tree change LIST for the (pinned) workspace in ONE
// `git diff <base>` pass (status, ± counts, symbols, whitespace-only classification), then add
// untracked files. Content hunks for the detail view stay lazy via readFileDiff().
export function computeChanges(now: number = Date.now(), base?: string | null): ChangesResponse {
  const root = repoRoot();
  if (tryGit(["rev-parse", "--is-inside-work-tree"], root) !== "true") {
    return { repo: false, files: [], touched: {} };
  }
  const raw = runGit(["diff", "--no-color", "--no-ext-diff", ...diffBase(root, base)], root, false) ?? "";

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
      cues: m.cues,
    });
  }

  // `git diff` omits untracked files — add them as all-additions.
  for (const rel of (tryGit(["ls-files", "--others", "--exclude-standard", "-z"], root) ?? "").split("\0").filter(Boolean)) {
    files.push(readUntracked(root, rel));
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { repo: true, files, touched: readTouched(now) };
}

// The added lines per changed file (vs the same base the list uses) — input for the on-demand
// quality scan (clone detection). One extra git pass, only when the user asks for a scan.
export function computeAddedLines(base?: string | null): Map<string, string[]> {
  const root = repoRoot();
  const raw = runGit(["diff", "--no-color", "--no-ext-diff", ...diffBase(root, base)], root, false) ?? "";
  const out = new Map<string, string[]>();
  for (const [path, m] of parseFullDiff(raw, { collectAdded: true })) {
    if (m.addedLines?.length) out.set(path, m.addedLines);
  }
  // Untracked files are all-added: include their content so brand-new duplicated files get caught.
  for (const rel of (tryGit(["ls-files", "--others", "--exclude-standard", "-z"], root) ?? "").split("\0").filter(Boolean)) {
    try {
      if (statSync(join(root, rel)).size > MAX_FILE_BYTES) continue;
      const buf = readFileSync(join(root, rel));
      if (!buf.includes(0)) out.set(rel, buf.toString("utf8").split("\n"));
    } catch {
      /* unreadable — skip */
    }
  }
  return out;
}

// Keep an untrusted `?path` inside the repo (no traversal); returns the absolute path or null.
function withinRepo(root: string, rel: string): string | null {
  const clean = rel.split("\\").join("/").replace(/^\/+/, "");
  const abs = resolve(root, clean);
  const guard = root.endsWith("/") ? root : root + "/";
  return abs === root || abs.startsWith(guard) ? abs : null;
}

// Impure shell: read one file's raw unified diff for the renderer. Tracked files come straight
// from `git diff <base>` (the review baseline when active, else HEAD); an untracked file (absent
// from `git diff`) gets a synthesized new-file diff built from its working copy. Never trims —
// that would shift the diff.
export function readFileDiff(newPath: string, oldPath: string | null, base?: string | null): FileDiff {
  const root = repoRoot();
  const target = oldPath ? [oldPath, newPath] : [newPath];
  const tracked =
    runGit(["diff", "--no-color", "--no-ext-diff", ...diffBase(root, base), "--", ...target], root, false) ?? "";
  if (tracked.trim()) return { diff: tracked };

  const abs = withinRepo(root, newPath);
  if (!abs) return { diff: "" };
  try {
    if (statSync(abs).size > MAX_FILE_BYTES) return { diff: "" };
    const buf = readFileSync(abs);
    if (buf.includes(0)) return { diff: "" };
    const lines = buf.toString("utf8").split("\n");
    const n = realLineCount(lines);
    if (n === 0) return { diff: "" };
    const body = lines.slice(0, n).map((l) => "+" + l).join("\n");
    const p = newPath.split("\\").join("/").replace(/^\/+/, "");
    return { diff: `diff --git a/${p} b/${p}\nnew file mode 100644\n--- /dev/null\n+++ b/${p}\n@@ -0,0 +1,${n} @@\n${body}\n` };
  } catch {
    return { diff: "" };
  }
}
