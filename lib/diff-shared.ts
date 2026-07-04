// Client-safe primitives for the Changes surface: types + pure diff parsing, NO node imports —
// imported by client components (diff-detail, overview, file-card) AND by the impure server
// shells in lib/changes.ts, which re-exports everything here for existing importers.

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
  // Deterministic quality cues counted over ADDED lines (see QualityCues).
  cues?: QualityCues;
}

// Instant, deterministic quality cues from the added lines of a diff — no linter, no AST, no AI.
// maxIndent is a nesting-depth proxy (indentation IS nesting in every lang this repo ships).
export interface QualityCues {
  todos: number; // TODO / FIXME / HACK markers added
  consoles: number; // console.log/warn/error added
  anys: number; // `: any` / `as any` / `<any>` added (ts/tsx only)
  maxIndent: number; // deepest added line, in indent levels (2 spaces or 1 tab = 1 level)
}

// One file's raw unified git diff, fed to react-diff-view's parseDiff().
export interface FileDiff {
  diff: string;
}

// Above this many changed lines a diff is dropped (open in editor instead) — keeps a giant
// generated-file diff from freezing the renderer.
export const MAX_CHANGED_LINES = 1500;

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
  // Quality cues counted over the added lines (see QualityCues).
  cues: QualityCues;
  // The raw added lines, kept ONLY when the caller opts in (clone scanning) — memory-heavy.
  addedLines?: string[];
}

// Count the instant quality cues over a set of added lines. Pure.
export function qualityCues(added: readonly string[], lang: string): QualityCues {
  const ts = lang === "typescript";
  let todos = 0;
  let consoles = 0;
  let anys = 0;
  let maxIndent = 0;
  for (const l of added) {
    if (/\b(TODO|FIXME|HACK)\b/.test(l)) todos++;
    if (/\bconsole\.(log|warn|error|debug)\s*\(/.test(l)) consoles++;
    if (ts && /(:\s*any\b|\bas any\b|<any>)/.test(l)) anys++;
    const ws = /^[\t ]*/.exec(l)![0];
    const levels = ws.replace(/\t/g, "  ").length / 2;
    if (l.trim() && levels > maxIndent) maxIndent = levels;
  }
  return { todos, consoles, anys, maxIndent: Math.floor(maxIndent) };
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

export function parseFullDiff(raw: string, opts?: { collectAdded?: boolean }): Map<string, FileDiffMeta> {
  const out = new Map<string, FileDiffMeta>();
  let cur: FileDiffMeta | null = null;
  let curPath = "";
  let removed: string[] = [];
  let added: string[] = [];
  let fileAdded: string[] = [];
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
    cur.cues = qualityCues(fileAdded, langFromPath(curPath));
    if (opts?.collectAdded) cur.addedLines = fileAdded;
    fileAdded = [];
    out.set(curPath, cur);
    cur = null;
  };

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      closeFile();
      // `diff --git a/<old> b/<new>` — take the b/ path (a/ recovered from rename headers).
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      curPath = m?.[2] ?? "";
      cur = {
        status: "modified",
        additions: 0,
        deletions: 0,
        binary: false,
        symbols: [],
        formattingOnly: false,
        hunks: 0,
        cues: { todos: 0, consoles: 0, anys: 0, maxIndent: 0 },
      };
      sawRealHunk = false;
      fileAdded = [];
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
      fileAdded.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      cur.deletions += 1;
      removed.push(line.slice(1));
    }
  }
  closeFile();
  return out;
}

// Real line count of file content, ignoring the phantom empty line a trailing newline produces.
export function realLineCount(lines: string[]): number {
  return lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

// The file the agent most recently edited that's STILL in the change set — what the "Editing X"
// header names and the file that focus mode follows. Intersecting with `files` keeps a
// since-committed path from winning (it has no diff to show), and resolving `oldPath` catches a
// file touched under its pre-rename name. Null when nothing in the diff was touched this session.
// Pure — the header and focus target share it so the label and the click target can't disagree.
export function latestEditedFile(
  files: readonly { path: string; oldPath?: string | null }[],
  touched: Record<string, { lastAt: number } | undefined>,
): { path: string; lastAt: number } | null {
  let best: { path: string; lastAt: number } | null = null;
  for (const f of files) {
    const at = touched[f.path]?.lastAt ?? (f.oldPath ? touched[f.oldPath]?.lastAt : undefined);
    if (at !== undefined && (!best || at > best.lastAt)) best = { path: f.path, lastAt: at };
  }
  return best;
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
