import { dirname, resolve as resolvePath } from "node:path";
import type { Alias, LanguageResolver, ResolveCtx } from "./types";

// TS/JS resolver. This is the precise path that understands `tsconfig` `paths`
// aliases, index files, and every import form (static, dynamic, bare side-effect,
// require). Patterns and resolution match the original intel/extractors/code-graph.ts
// behavior exactly — the code-graph build now delegates here.

export const TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

const IMPORT_PATTERNS = [
  // The between-keyword-and-`from` span is bounded ({0,4000}) so a pathological single
  // line (e.g. a minified bundle) can't trigger catastrophic regex backtracking — real
  // `import … from` statements are far shorter than that.
  /(?:^|[\n;])\s*(?:import|export)[^'"`\n]{0,4000}?from\s*['"]([^'"`]+)['"]/g,
  /(?:^|[\n;])\s*import\s*['"]([^'"`]+)['"]/g, // bare side-effect import
  /\brequire\(\s*['"]([^'"`]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"`]+)['"]\s*\)/g,
];

function toPosix(p: string): string {
  return p.split(/[\\/]/).join("/");
}

// NodeNext / ESM TypeScript writes `./x.js` (and `.mjs`/`.cjs`) for a `./x.ts` source: the specifier
// names the compiled OUTPUT, which never exists in the tree being scanned. Map it back before
// probing — without this, beacon-desktop resolved 38 of its ~600 imports (e2e, 2026-09-07), and every
// cross-file call the symbol layer could have proved through an import fell to INFERRED instead.
const JS_TO_TS: Record<string, string[]> = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };

/** Try a repo-relative base against the file set: exact, compiled-name twin, +ext, /index+ext. */
function probe(repoRel: string, fileSet: Set<string>): string | null {
  if (fileSet.has(repoRel)) return repoRel;
  const jsExt = repoRel.match(/\.(?:m|c)?jsx?$/)?.[0];
  if (jsExt) {
    for (const ext of JS_TO_TS[jsExt] ?? []) {
      const p = repoRel.slice(0, -jsExt.length) + ext;
      if (fileSet.has(p)) return p;
    }
  }
  for (const ext of TS_EXTENSIONS) {
    const p = `${repoRel}${ext}`;
    if (fileSet.has(p)) return p;
  }
  for (const ext of TS_EXTENSIONS) {
    const p = `${repoRel}/index${ext}`;
    if (fileSet.has(p)) return p;
  }
  return null;
}

function specifiers(content: string): Set<string> {
  const out = new Set<string>();
  for (const re of IMPORT_PATTERNS) {
    for (const m of content.matchAll(re)) out.add(m[1]);
  }
  return out;
}

function resolveSpec(
  spec: string,
  fromFile: string,
  fileSet: Set<string>,
  aliases: Alias[],
): string | null {
  if (spec.startsWith(".")) {
    const abs = resolvePath("/", dirname(fromFile), spec); // "/"-rooted, harmless
    const repoRel = toPosix(abs).replace(/^\//, "");
    return probe(repoRel, fileSet);
  }
  // Try every alias whose prefix matches and return the first that hits a real file.
  // (Single-root: one alias. Monorepo: two roots may both define `@/`, so we must not
  // stop at the first prefix match — only at the first that actually resolves.)
  for (const a of aliases) {
    if (spec.startsWith(a.from)) {
      const rest = spec.slice(a.from.length);
      const repoRel = a.to ? `${a.to}/${rest}` : rest;
      const hit = probe(repoRel, fileSet);
      if (hit) return hit;
    }
  }
  return null; // bare package — external
}

export const tsResolver: LanguageResolver = {
  id: "ts",
  extensions: TS_EXTENSIONS,
  specifiers,
  resolve(spec, fromFile, ctx: ResolveCtx) {
    const hit = resolveSpec(spec, fromFile, ctx.fileSet, ctx.tsAliases ?? []);
    return hit ? [hit] : [];
  },
};
