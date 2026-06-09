import { dirname, join, normalize } from "node:path";
import type { LanguageResolver, ResolveCtx } from "./types";

// Python resolver. Handles the two real import shapes:
//   import pkg.mod / from pkg.mod import x   → absolute dotted module
//   from .mod import x / from ..pkg import y → package-relative (leading dots)
// Resolves to a `.py`/`.pyi` file or a package `__init__.py`. Absolute imports are
// probed repo-relative (a source-root prefix like `src/` is handled at build time by
// the base-relative path scheme); unresolved → external (stdlib / third-party).

export const PY_EXTENSIONS = [".py", ".pyi"];

const PATTERNS = [
  /(?:^|[\n;])\s*from\s+(\.*[\w.]*)\s+import\b/g, // from .mod import x  |  from pkg.mod import x
  /(?:^|[\n;])\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/g, // import a.b, c.d
];

function probe(base: string, fileSet: Set<string>): string[] {
  for (const cand of [`${base}.py`, `${base}/__init__.py`, `${base}.pyi`]) {
    if (fileSet.has(cand)) return [cand];
  }
  return [];
}

function specifiers(content: string): Set<string> {
  const out = new Set<string>();
  // from ... import
  for (const m of content.matchAll(PATTERNS[0])) {
    const s = m[1].trim();
    if (s) out.add(s);
  }
  // import a.b, c.d  → split the comma list
  for (const m of content.matchAll(PATTERNS[1])) {
    for (const tok of m[1].split(/\s*,\s*/)) {
      const t = tok.trim().split(/\s+as\s+/)[0].trim();
      if (t) out.add(t);
    }
  }
  return out;
}

export const pythonResolver: LanguageResolver = {
  id: "python",
  extensions: PY_EXTENSIONS,
  specifiers,
  resolve(spec, fromFile, ctx: ResolveCtx) {
    if (spec.startsWith(".")) {
      // Leading dots: 1 = current package, each extra = one level up.
      const dots = spec.length - spec.replace(/^\.+/, "").length;
      const rest = spec.slice(dots); // module path after the dots (may be "")
      let dir = dirname(fromFile);
      for (let i = 1; i < dots; i++) dir = dirname(dir);
      // "from . import x" loses x — best-effort resolves to the package itself.
      const base = rest ? join(dir, rest.replace(/\./g, "/")) : dir;
      return probe(normalize(base).replace(/\\/g, "/"), ctx.fileSet);
    }
    // Absolute dotted module, probed repo-relative.
    return probe(spec.replace(/\./g, "/"), ctx.fileSet);
  },
};
