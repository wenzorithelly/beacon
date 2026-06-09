import { dirname } from "node:path";
import type { LanguageResolver, ResolveCtx } from "./types";

// Go resolver. Go imports are package paths ("example.com/app/util"), not file paths.
// With the module path from go.mod, an import under that prefix maps to a package
// directory; the package is every .go file directly in that dir. We emit an edge to
// each of them (a file-level approximation of "this file depends on that package").
// Imports outside the module (stdlib, third-party) are external → [].

export const GO_EXTENSIONS = [".go"];

const SINGLE = /(?:^|[\n;])\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/g; // import "x"  |  import alias "x"
const BLOCK = /(?:^|[\n;])\s*import\s*\(([\s\S]*?)\)/g; // import ( "a" \n "b" )
const QUOTED = /"([^"]+)"/g;

function specifiers(content: string): Set<string> {
  const out = new Set<string>();
  SINGLE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SINGLE.exec(content))) out.add(m[1]);
  BLOCK.lastIndex = 0;
  while ((m = BLOCK.exec(content))) {
    QUOTED.lastIndex = 0;
    let q: RegExpExecArray | null;
    while ((q = QUOTED.exec(m[1]))) out.add(q[1]);
  }
  return out;
}

export const goResolver: LanguageResolver = {
  id: "go",
  extensions: GO_EXTENSIONS,
  resolve(spec, _fromFile, ctx: ResolveCtx) {
    const mod = ctx.goModulePath;
    if (!mod) return [];
    let dir: string | null = null;
    if (spec === mod) dir = "";
    else if (spec.startsWith(`${mod}/`)) dir = spec.slice(mod.length + 1);
    if (dir === null) return []; // stdlib / third-party
    const out: string[] = [];
    for (const p of ctx.fileSet) {
      if (!p.endsWith(".go")) continue;
      const d = dirname(p);
      if ((dir === "" && d === ".") || d === dir) out.push(p);
    }
    return out.sort();
  },
  specifiers,
};
