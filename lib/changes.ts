import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { repoRoot } from "@/lib/project";
import { readTouched, type TouchedMap } from "@/lib/touched-files";

// The live "Changes" surface reads the git working tree — as the agent executes an approved
// plan its edits become uncommitted changes, and `git diff` IS "what's being changed". Nothing
// is persisted: this recomputes from git on demand. ONE full `git diff HEAD` pass per refresh
// yields the file list AND the overview signals (per-file symbols from @@ hunk headers,
// whitespace-only classification, ± counts); each file's raw per-file diff is still read lazily
// when it's selected. The parsers here are PURE (no git/fs) so they're unit-testable;
// computeChanges()/readFileDiff() are the impure shells.

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface ChangedFile {
  // New path (repo-relative POSIX); for a delete this is the removed file's path.
  path: string;
  // Pre-rename path, when status === "renamed".
  oldPath?: string;
  status: ChangeStatus;
  additions: number;
  deletions: number;
  // highlight.js language name for the diff highlighter.
  lang: string;
  binary?: boolean;
  tooLarge?: boolean;
  // Enclosing symbols git names in @@ hunk headers — the card's "what changed here" line.
  symbols: string[];
  // Every hunk is whitespace-only reflow — folded by the skim layer.
  formattingOnly?: boolean;
  // How many files import this one (CodeFile.inDegree) — attached by the server boundary.
  inDegree?: number;
}

export interface ChangesResponse {
  repo: boolean;
  files: ChangedFile[];
  // Full per-file recency map (edit count + lastAt) — drives the activity lens episodes and the
  // live overview strip, not just a "this session" filter.
  touched: TouchedMap;
}

// One file's raw unified git diff, fed to react-diff-view's parseDiff().
export interface FileDiff {
  diff: string;
}

// Above this many changed lines a diff is dropped (open in editor instead) — keeps a giant
// generated-file diff from freezing the renderer.
export const MAX_CHANGED_LINES = 1500;
// Files larger than this aren't read into a diff (open in editor instead).
const MAX_FILE_BYTES = 512 * 1024;

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript", json: "json", md: "markdown", mdx: "markdown",
  css: "css", scss: "scss", less: "less", html: "html", py: "python", rb: "ruby",
  rs: "rust", go: "go", java: "java", c: "c", h: "c", cpp: "cpp", cs: "csharp",
  php: "php", sh: "bash", bash: "bash", zsh: "bash", yml: "yaml", yaml: "yaml",
  toml: "ini", ini: "ini", sql: "sql", swift: "swift", kt: "kotlin",
};

export function langFromPath(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "plaintext";
  return LANG_BY_EXT[path.slice(dot + 1).toLowerCase()] ?? "plaintext";
}

// ── Full-diff parsing (pure) ─────────────────────────────────────────────────

export interface FileDiffMeta {
  status: ChangeStatus;
  oldPath?: string;
  additions: number;
  deletions: number;
  binary: boolean;
  // Deduped enclosing symbols from @@ headers, first-seen order.
  symbols: string[];
  // True when EVERY hunk is whitespace-only (and there is ≥1 hunk).
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
  const a = bag(removed);
  const b = bag(added);
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

// Real line count of file content, ignoring the phantom empty line a trailing newline produces.
function realLineCount(lines: string[]): number {
  return lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

// Summarize an untracked file for the list (all additions). Pure so it's testable.
export function untrackedFile(path: string, content: string): ChangedFile {
  const n = realLineCount(content.split("\n"));
  return {
    path,
    status: "added",
    additions: n,
    deletions: 0,
    lang: langFromPath(path),
    symbols: [],
    tooLarge: n > MAX_CHANGED_LINES || undefined,
  };
}

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

// Impure shell: compute the working-tree change LIST for the (pinned) workspace in ONE
// `git diff HEAD` pass (status, ± counts, symbols, whitespace-only classification), then add
// untracked files. Content hunks for the detail view stay lazy via readFileDiff().
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

  // `git diff` omits untracked files — add them as all-additions.
  for (const rel of (tryGit(["ls-files", "--others", "--exclude-standard", "-z"], root) ?? "").split("\0").filter(Boolean)) {
    files.push(readUntracked(root, rel));
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { repo: true, files, touched: readTouched(now) };
}

// Keep an untrusted `?path` inside the repo (no traversal); returns the absolute path or null.
function withinRepo(root: string, rel: string): string | null {
  const clean = rel.split("\\").join("/").replace(/^\/+/, "");
  const abs = resolve(root, clean);
  const guard = root.endsWith("/") ? root : root + "/";
  return abs === root || abs.startsWith(guard) ? abs : null;
}

// Impure shell: read one file's raw unified diff for the renderer. Tracked files come straight
// from `git diff HEAD`; an untracked file (absent from `git diff`) gets a synthesized new-file
// diff built from its working copy. Never trims — that would shift the diff.
export function readFileDiff(newPath: string, oldPath: string | null): FileDiff {
  const root = repoRoot();
  const target = oldPath ? [oldPath, newPath] : [newPath];
  const tracked = runGit(["diff", "--no-color", "--no-ext-diff", "HEAD", "--", ...target], root, false) ?? "";
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
