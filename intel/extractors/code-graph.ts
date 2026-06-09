import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import {
  allExtensions,
  detectLang,
  resolverForPath,
  type Alias,
  type ResolveCtx,
} from "./languages";

// Code graph: walk every source file in the configured root(s), dispatch each file to
// its language resolver (see ./languages), resolve import specifiers to internal file
// paths, and return a forward-link snapshot the watcher POSTs to /api/code-graph. The
// shape mirrors Obsidian's MetadataCache.resolvedLinks but boolean (a top-of-file
// import dedupes to one (from, to) edge).
//
// Multi-root: paths are computed relative to a common base so they stay globally
// unique and human-readable; each file is tagged with its `root` (package) and `lang`.

// Directories we never want in the graph.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "__pycache__",
  "target",
  ".venv",
  "venv",
  "env",
  ".turbo",
  "coverage",
  ".beacon",
  ".playwright-mcp",
  "generated",
]);

export interface CodeGraphFile {
  path: string;
  lang: string | null;
  root: string | null;
  mtimeMs?: number;
  size?: number;
}

export interface CodeGraphSnapshot {
  files: CodeGraphFile[];
  edges: { from: string; to: string }[];
  /** Per-build extraction counters — how many files were re-read vs. served from cache. */
  stats?: { read: number; reused: number };
}

// ── Walk ──────────────────────────────────────────────────────────────────────

function walk(root: string, dir: string, exts: Set<string>, out: string[]) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walk(root, full, exts, out);
      continue;
    }
    if (!e.isFile()) continue;
    if (e.name.endsWith(".d.ts")) continue;
    if (!exts.has(extname(e.name).toLowerCase())) continue;
    out.push(relative(root, full));
  }
}

/** Walk one root for indexable source files. Returns POSIX, root-relative, sorted. */
export function scanCodeFiles(root: string): string[] {
  const out: string[] = [];
  walk(root, root, allExtensions(), out);
  return out.map((p) => p.split(/[\\/]/).join("/")).sort();
}

// ── tsconfig paths ────────────────────────────────────────────────────────────

function parseTsconfig(src: string): unknown {
  // Most repos (incl. this one) use plain JSON. Try plain first — a naive comment
  // stripper would eat across unrelated string literals and corrupt the file.
  try {
    return JSON.parse(src);
  } catch {
    /* fall through to strip */
  }
  const stripped = src
    .replace(/\/\*[^"]*?\*\//g, "")
    .replace(/(^|[^:"])\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(stripped);
}

function normalizeRel(p: string): string {
  return p.replace(/^\.\/?/, "").replace(/\/$/, "");
}

/** tsconfig `paths` aliases for a root, repo-relative to THAT root (to = "" or "src"). */
export function loadTsAliases(root: string): Alias[] {
  const path = join(root, "tsconfig.json");
  if (!existsSync(path)) return [];
  let cfg: { compilerOptions?: { paths?: Record<string, string[]>; baseUrl?: string } };
  try {
    cfg = parseTsconfig(readFileSync(path, "utf8")) as typeof cfg;
  } catch {
    return [];
  }
  const paths = cfg.compilerOptions?.paths ?? {};
  const baseRel = normalizeRel(cfg.compilerOptions?.baseUrl ?? ".");
  const out: Alias[] = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    if (!pattern.endsWith("/*") || !targets.length) continue;
    const target = targets[0];
    if (!target.endsWith("/*")) continue;
    const from = pattern.slice(0, -1); // "@/"
    const targetRel = normalizeRel(target.slice(0, -1)); // "" or "src"
    const to = [baseRel, targetRel].filter(Boolean).join("/");
    out.push({ from, to });
  }
  return out;
}

/** Module path declared in a go.mod, e.g. "example.com/app", or null. */
export function loadGoModule(dir: string): string | null {
  const path = join(dir, "go.mod");
  if (!existsSync(path)) return null;
  try {
    const m = /^\s*module\s+(\S+)/m.exec(readFileSync(path, "utf8"));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// ── Build ───────────────────────────────────────────────────────────────────

function toPosix(p: string): string {
  return p.split(/[\\/]/).join("/");
}

/** Longest common directory prefix of absolute paths (POSIX-normalized). */
function commonAncestor(paths: string[]): string {
  if (paths.length === 1) return paths[0];
  const split = paths.map((p) => toPosix(p).split("/"));
  const first = split[0];
  let i = 0;
  for (; i < first.length; i++) {
    if (!split.every((s) => s[i] === first[i])) break;
  }
  return first.slice(0, i).join("/") || "/";
}

interface FileMeta {
  path: string; // base-relative POSIX
  abs: string;
  root: string | null;
  mtimeMs: number;
  size: number;
}

/** Scan + stat all roots (cheap, no file reads). Resolves the base + ResolveCtx. */
function scanRoots(rootOrRoots: string | string[], base?: string): { metas: FileMeta[]; ctx: ResolveCtx } {
  const roots = (Array.isArray(rootOrRoots) ? rootOrRoots : [rootOrRoots]).map((r) => toPosix(resolve(r)));
  const baseDir = toPosix(base ? resolve(base) : roots.length === 1 ? roots[0] : commonAncestor(roots));

  const byPath = new Map<string, FileMeta>();
  const aliases: Alias[] = [];
  for (const root of roots) {
    const rootRel = toPosix(relative(baseDir, root)); // "" for the base root, "packages/api" for a sub-root
    for (const a of loadTsAliases(root)) {
      aliases.push({ from: a.from, to: [rootRel, a.to].filter(Boolean).join("/") });
    }
    for (const rel of scanCodeFiles(root)) {
      const abs = toPosix(join(root, rel));
      const path = toPosix(relative(baseDir, abs));
      if (byPath.has(path)) continue; // overlapping roots — keep first
      try {
        const st = statSync(abs);
        byPath.set(path, { path, abs, root: rootRel || null, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        /* vanished between readdir and stat — skip */
      }
    }
  }

  const goModulePath = roots.map(loadGoModule).find(Boolean) ?? loadGoModule(baseDir);
  const metas = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { metas, ctx: { fileSet: new Set(byPath.keys()), tsAliases: aliases, goModulePath } };
}

/** Read + extract one file's import specifiers. Giant/unreadable files contribute none. */
function extractSpecifiers(meta: FileMeta): Set<string> {
  const resolver = resolverForPath(meta.path);
  if (!resolver || meta.size > 200_000) return new Set();
  try {
    return resolver.specifiers(readFileSync(meta.abs, "utf8"));
  } catch {
    return new Set();
  }
}

/**
 * Stateful, incremental code-graph builder. Caches each file's extracted import
 * specifiers keyed by (mtimeMs, size); a rebuild re-reads ONLY files whose stat
 * changed and reuses cached specifiers for the rest — so a save in a large repo
 * re-parses one file, not thousands. Resolution still runs every build against the
 * fresh file set, so adding a file correctly lights up edges from unchanged importers.
 */
export function createCodeGraphBuilder(rootOrRoots: string | string[], base?: string) {
  const cache = new Map<string, { mtimeMs: number; size: number; specifiers: Set<string> }>();

  function build(): CodeGraphSnapshot {
    const { metas, ctx } = scanRoots(rootOrRoots, base);
    const present = new Set(metas.map((m) => m.path));
    for (const k of [...cache.keys()]) if (!present.has(k)) cache.delete(k);

    let read = 0;
    let reused = 0;
    const edges: { from: string; to: string }[] = [];
    for (const m of metas) {
      const cached = cache.get(m.path);
      let specs: Set<string>;
      if (cached && cached.mtimeMs === m.mtimeMs && cached.size === m.size) {
        specs = cached.specifiers;
        reused++;
      } else {
        specs = extractSpecifiers(m);
        cache.set(m.path, { mtimeMs: m.mtimeMs, size: m.size, specifiers: specs });
        read++;
      }
      const resolver = resolverForPath(m.path);
      if (!resolver) continue;
      const seen = new Set<string>();
      for (const spec of specs) {
        for (const hit of resolver.resolve(spec, m.path, ctx)) {
          if (!hit || hit === m.path || seen.has(hit)) continue;
          seen.add(hit);
          edges.push({ from: m.path, to: hit });
        }
      }
    }

    const files: CodeGraphFile[] = metas.map((m) => ({
      path: m.path,
      lang: detectLang(m.path),
      root: m.root,
      mtimeMs: m.mtimeMs,
      size: m.size,
    }));
    return { files, edges, stats: { read, reused } };
  }

  return { build };
}

/**
 * One-shot code-graph snapshot (no caching across calls). Accepts a single root
 * (back-compat) or many; with many, every path is computed relative to their common
 * base so paths stay unique + readable.
 */
export function buildCodeGraph(rootOrRoots: string | string[], base?: string): CodeGraphSnapshot {
  return createCodeGraphBuilder(rootOrRoots, base).build();
}
