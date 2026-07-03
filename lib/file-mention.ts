// Deterministic file-reference resolver for plan descriptions. Pure + client-safe (no node:fs,
// no DB) so it runs in the markdown renderer. A backticked token in plan prose only becomes a
// clickable "open in editor" mention when it matches a REAL repo file — never a heuristic guess.
// When a bare basename matches MORE THAN ONE file (same name, different folders) the renderer
// shows a pick-one dropdown, so resolveFileToken returns every same-name candidate.

export interface FileIndex {
  /** Every repo-relative path, for exact-path matches. */
  byPath: Set<string>;
  /** basename (with extension) → every path that ends in it, for bare-name + ambiguity matches. */
  byBase: Map<string, string[]>;
}

/** Build the lookup index from the workspace's known repo-relative file paths. */
export function buildFileIndex(paths: string[]): FileIndex {
  const byPath = new Set<string>();
  const byBase = new Map<string, string[]>();
  for (const raw of paths) {
    const p = raw.trim();
    if (!p) continue;
    byPath.add(p);
    const base = basename(p);
    const arr = byBase.get(base);
    if (arr) arr.push(p);
    else byBase.set(base, [p]);
  }
  return { byPath, byBase };
}

const basename = (p: string) => p.split("/").filter(Boolean).pop() || p;

/**
 * Resolve a code token (the text inside `backticks`) to the real repo file(s) it names.
 * Returns the candidate repo-relative paths (sorted):
 *   - `[]`        → not a deliberate file reference; the renderer leaves it as plain code.
 *   - `[path]`    → exactly one file; click opens it directly.
 *   - `[a, b, …]` → several files SHARING THE SAME basename; click offers a pick-one dropdown.
 *
 * A BARE filename (no path separator) only resolves when it uniquely names one file — a bare
 * `route.ts` that matches dozens of files is noise, not a reference, so it stays plain. The
 * same-name dropdown is reserved for a PATH-QUALIFIED token (e.g. `[id]/route.ts`) that still
 * matches more than one file.
 */
export function resolveFileToken(index: FileIndex, token: string): string[] {
  // Strip a trailing `:line` / `:line:col` cursor suffix (e.g. `lib/db.ts:42`), then a leading
  // `./` or `/`, so the path matches the stored repo-relative form.
  const t = token
    .trim()
    .replace(/:\d+(?::\d+)?$/, "")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  if (!t) return [];

  // Exact repo-relative path — the unambiguous common case.
  if (index.byPath.has(t)) return [t];

  const candidates = index.byBase.get(basename(t)) ?? [];
  if (t.includes("/")) {
    // A partial path is narrowed to files whose path ends in it; 1 → open, >1 → same-name dropdown.
    return [...new Set(candidates.filter((p) => p === t || p.endsWith("/" + t)))].sort();
  }
  // A bare basename is a reference ONLY when it is unambiguous (matches exactly one file).
  return candidates.length === 1 ? [candidates[0]] : [];
}

/**
 * Scan plan/description prose for backticked tokens that resolve to exactly one real repo file,
 * returning the de-duplicated, sorted file set. Used to seed a plan's scope contract from the
 * files it NAMES when it ships no explicit `contract` array — the same deterministic resolver the
 * renderer uses to linkify mentions, so "the plan's scope" == "the files the plan points at".
 */
export function resolveMentionedFiles(markdown: string, paths: string[]): string[] {
  const index = buildFileIndex(paths);
  const out = new Set<string>();
  for (const m of markdown.matchAll(/`([^`\n]+)`/g)) {
    const hits = resolveFileToken(index, m[1]);
    if (hits.length === 1) out.add(hits[0]);
  }
  return [...out].sort();
}
