import { extname } from "node:path";
import type { LanguageResolver } from "./types";
import { tsResolver } from "./ts";
import { pythonResolver } from "./python";
import { goResolver } from "./go";
import { rustResolver } from "./rust";
import { fallbackResolver } from "./fallback";

export type { Alias, LanguageResolver, ResolveCtx } from "./types";

// The registry: precise resolvers first, the heuristic fallback last. Extensions are
// disjoint, so dispatch is unambiguous; the order only documents intent.
export const RESOLVERS: LanguageResolver[] = [
  tsResolver,
  pythonResolver,
  goResolver,
  rustResolver,
  fallbackResolver,
];

const RESOLVER_BY_EXT = new Map<string, LanguageResolver>();
for (const r of RESOLVERS) for (const e of r.extensions) RESOLVER_BY_EXT.set(e, r);

// Extension → clean, groupable language id (for the CodeFile.lang tag + canvas color).
// Extensions present in the registry but absent here fall back to the bare extension.
const LANG_BY_EXT: Record<string, string> = {
  ".ts": "ts", ".tsx": "ts",
  ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js",
  ".py": "py", ".pyi": "py",
  ".go": "go",
  ".rs": "rs",
  ".swift": "swift",
  ".java": "java",
  ".rb": "ruby",
  ".kt": "kotlin", ".kts": "kotlin",
  ".cs": "csharp",
  ".php": "php",
  ".scala": "scala",
  ".c": "c", ".h": "c",
  ".cpp": "cpp", ".hpp": "cpp", ".cc": "cpp", ".hh": "cpp",
  ".m": "objc", ".mm": "objc",
  ".ex": "elixir", ".exs": "elixir",
  ".lua": "lua", ".dart": "dart", ".vue": "vue", ".svelte": "svelte",
};

/** The resolver that handles this file's extension, or null if not a source file. */
export function resolverForPath(path: string): LanguageResolver | null {
  return RESOLVER_BY_EXT.get(extname(path).toLowerCase()) ?? null;
}

/** Clean language id for a path (by extension), or null if not graphed. */
export function detectLang(path: string): string | null {
  const ext = extname(path).toLowerCase();
  if (!RESOLVER_BY_EXT.has(ext)) return null;
  return LANG_BY_EXT[ext] ?? ext.slice(1);
}

/** Every extension any resolver claims — the scanner's allow-list. */
export function allExtensions(): Set<string> {
  return new Set(RESOLVER_BY_EXT.keys());
}
