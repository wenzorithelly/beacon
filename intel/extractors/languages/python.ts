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
    // Absolute dotted module. Probe under each ancestor directory of the importing file,
    // DEEPEST FIRST (the closest enclosing package root wins), ending at the scan base.
    // This is what resolves a monolith layout: backend/app/main.py doing
    // `from app.services import x` hits backend/app/services.py even though the scanned
    // root is the repo — Python's sys.path root (backend/) isn't the repo root.
    const rel = spec.replace(/\./g, "/");
    const dirs: string[] = [];
    let d = dirname(fromFile);
    while (d && d !== "." && d !== "/") {
      dirs.push(d);
      d = dirname(d);
    }
    dirs.push(""); // the scan base itself (flat layout)
    for (const dir of dirs) {
      const hit = probe(dir ? `${dir}/${rel}` : rel, ctx.fileSet);
      if (hit.length) return hit;
    }
    return [];
  },
};
