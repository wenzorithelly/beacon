// A pluggable, per-language import resolver. The code-graph build dispatches each
// scanned file to the resolver matching its extension (see ./index.ts), extracts the
// file's import specifiers, and resolves each to zero or more repo-relative target
// paths. Edges only form between files a resolver can resolve, so a `.py` import never
// matches a `.ts` file — cross-language noise stays out by construction.

export interface Alias {
  from: string; // e.g. "@/" — matched by prefix
  to: string; // e.g. "" (repo-relative) or "src"
}

/** Everything a resolver might need, precomputed once per build. */
export interface ResolveCtx {
  /** Every repo-relative POSIX path in the graph (all languages). */
  fileSet: Set<string>;
  /** tsconfig `paths` aliases (TS/JS only). */
  tsAliases?: Alias[];
  /** Module path from go.mod, e.g. "example.com/app" (Go only). */
  goModulePath?: string | null;
}

export interface LanguageResolver {
  /** Stable id: "ts" | "python" | "go" | "rust" | "fallback". */
  id: string;
  /** Lowercase extensions (with dot) this resolver claims. */
  extensions: string[];
  /** Pull the raw import/module specifiers out of a file's full content. */
  specifiers(content: string): Set<string>;
  /** Resolve one specifier to its internal target path(s); `[]` if external/unresolved. */
  resolve(spec: string, fromFile: string, ctx: ResolveCtx): string[];
}
