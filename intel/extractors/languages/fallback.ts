import { dirname, extname, join, normalize } from "node:path";
import type { LanguageResolver, ResolveCtx } from "./types";

// Heuristic fallback for every recognized source extension without a precise
// resolver (Swift, Java, Ruby, Kotlin, C#, PHP, C/C++, …). Best-effort and
// deterministic: extract common import/require/include/using forms, then resolve
// path-like specifiers relative to the importing file (preferring its own
// extension) or repo-relative. Module-only specifiers that map to no file
// (e.g. Swift `import Foo`) stay unresolved — that's the documented tradeoff.

export const FALLBACK_EXTENSIONS = [
  ".swift", ".java", ".rb", ".kt", ".kts", ".cs", ".php", ".scala",
  ".c", ".h", ".cpp", ".hpp", ".cc", ".hh", ".m", ".mm",
  ".ex", ".exs", ".lua", ".dart", ".vue", ".svelte",
];

const PATTERNS = [
  /\b(?:require_relative|require|include|import|use|using|from)\s*\(?\s*['"]([^'"`\n]+)['"]/g,
  /(?:^|[\n;])\s*import\s+([\w.]+)/g, // java/swift: import a.b.C
  /(?:^|[\n;])\s*from\s+([\w.]+)\s+import\b/g, // python-like
  /(?:^|[\n;])\s*using\s+([\w.]+)\s*;/g, // C#: using A.B;
  /(?:^|[\n;])\s*use\s+([\w\\]+)/g, // php: use A\B\C;
  /#\s*include\s*[<"]([^>"\n]+)[>"]/g, // C/C++: #include "x"
];

function specifiers(content: string): Set<string> {
  const out = new Set<string>();
  for (const re of PATTERNS) {
    for (const m of content.matchAll(re)) {
      const s = m[1].trim();
      if (s) out.add(s);
    }
  }
  return out;
}

export const fallbackResolver: LanguageResolver = {
  id: "fallback",
  extensions: FALLBACK_EXTENSIONS,
  specifiers,
  resolve(spec, fromFile, ctx: ResolveCtx) {
    const own = extname(fromFile).toLowerCase();
    const exts = [own, ...FALLBACK_EXTENSIONS].filter((e, i, a) => e && a.indexOf(e) === i);

    const hasSep = spec.includes("/") || spec.includes("\\");
    // Path-like (relative or already slashed) → keep; dotted/`::` module → slashes.
    const path = spec.startsWith(".") || hasSep
      ? spec.replace(/\\/g, "/")
      : spec.replace(/[.:]+/g, "/");

    const bases = [
      normalize(join(dirname(fromFile), path)).replace(/\\/g, "/"), // relative to file
      path.replace(/^\.\//, ""), // repo-relative
    ];
    for (const b of bases) {
      if (ctx.fileSet.has(b)) return [b]; // spec already had an extension
      for (const e of exts) {
        const cand = b.endsWith(e) ? b : `${b}${e}`;
        if (ctx.fileSet.has(cand)) return [cand];
        if (ctx.fileSet.has(`${b}/index${e}`)) return [`${b}/index${e}`];
      }
    }
    return [];
  },
};
