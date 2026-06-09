import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
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

// ── Cooperative time-slicing ────────────────────────────────────────────────

/**
 * A yielder hands the event loop back when a scan batch has run longer than a budget,
 * so a cold full-repo extract never blocks a single tick longer than ~budgetMs. The
 * daemon runs on ONE event loop, so this is what keeps workspace-switch, /plan, and
 * /api/map responsive (and the plan Approve verdict flowing) while a repo is scanned.
 */
type Yielder = () => Promise<void>;

function makeYielder(budgetMs = 5): Yielder {
  let last = performance.now();
  return async () => {
    if (performance.now() - last > budgetMs) {
      await new Promise<void>((r) => setImmediate(r));
      last = performance.now();
    }
  };
}

/** No-op yielder for callers that don't need to slice (e.g. small one-shot test calls). */
const NO_YIELD: Yielder = () => Promise.resolve();

// ── Walk ──────────────────────────────────────────────────────────────────────

async function walk(
  root: string,
  dir: string,
  exts: Set<string>,
  out: string[],
  onYield: Yielder,
) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(root, full, exts, out, onYield);
      continue;
    }
    if (!e.isFile()) continue;
    if (e.name.endsWith(".d.ts")) continue;
    if (!exts.has(extname(e.name).toLowerCase())) continue;
    out.push(relative(root, full));
  }
  await onYield(); // breathe once per directory
}

/** Walk one root for indexable source files. Returns POSIX, root-relative, sorted. */
export async function scanCodeFiles(root: string, onYield: Yielder = NO_YIELD): Promise<string[]> {
  const out: string[] = [];
  await walk(root, root, allExtensions(), out, onYield);
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
async function scanRoots(
  rootOrRoots: string | string[],
  base: string | undefined,
  onYield: Yielder,
): Promise<{ metas: FileMeta[]; ctx: ResolveCtx }> {
  const roots = (Array.isArray(rootOrRoots) ? rootOrRoots : [rootOrRoots]).map((r) => toPosix(resolve(r)));
  const baseDir = toPosix(base ? resolve(base) : roots.length === 1 ? roots[0] : commonAncestor(roots));

  const byPath = new Map<string, FileMeta>();
  const aliases: Alias[] = [];
  for (const root of roots) {
    const rootRel = toPosix(relative(baseDir, root)); // "" for the base root, "packages/api" for a sub-root
    for (const a of loadTsAliases(root)) {
      aliases.push({ from: a.from, to: [rootRel, a.to].filter(Boolean).join("/") });
    }
    for (const rel of await scanCodeFiles(root, onYield)) {
      const abs = toPosix(join(root, rel));
      const path = toPosix(relative(baseDir, abs));
      if (byPath.has(path)) continue; // overlapping roots — keep first
      try {
        const st = await stat(abs);
        byPath.set(path, { path, abs, root: rootRel || null, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        /* vanished between readdir and stat — skip */
      }
      await onYield();
    }
  }

  const goModulePath = roots.map(loadGoModule).find(Boolean) ?? loadGoModule(baseDir);
  const metas = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { metas, ctx: { fileSet: new Set(byPath.keys()), tsAliases: aliases, goModulePath } };
}

// A single line longer than this is a minified/generated artifact, not hand-written source:
// it has no meaningful imports to graph AND is the classic trigger for pathological
// (catastrophic-backtracking) regex extraction. Skipping it keeps the watcher safe + light.
const MAX_LINE = 50_000;
function hasOverlongLine(s: string): boolean {
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10) {
      if (i - start > MAX_LINE) return true;
      start = i + 1;
    }
  }
  return s.length - start > MAX_LINE;
}

/** Read + extract one file's import specifiers. Giant/unreadable/minified files contribute none. */
async function extractSpecifiers(meta: FileMeta): Promise<Set<string>> {
  const resolver = resolverForPath(meta.path);
  if (!resolver || meta.size > 200_000) return new Set();
  try {
    const content = await readFile(meta.abs, "utf8");
    if (hasOverlongLine(content)) return new Set();
    return resolver.specifiers(content);
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

  async function build(): Promise<CodeGraphSnapshot> {
    const onYield = makeYielder(); // one continuous budget clock across scan + extract
    const { metas, ctx } = await scanRoots(rootOrRoots, base, onYield);
    const present = new Set(metas.map((m) => m.path));
    for (const k of [...cache.keys()]) if (!present.has(k)) cache.delete(k);

    let read = 0;
    let reused = 0;
    const edges: { from: string; to: string }[] = [];
    for (const m of metas) {
      await onYield();
      const cached = cache.get(m.path);
      let specs: Set<string>;
      if (cached && cached.mtimeMs === m.mtimeMs && cached.size === m.size) {
        specs = cached.specifiers;
        reused++;
      } else {
        specs = await extractSpecifiers(m);
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
export function buildCodeGraph(
  rootOrRoots: string | string[],
  base?: string,
): Promise<CodeGraphSnapshot> {
  return createCodeGraphBuilder(rootOrRoots, base).build();
}

// ── Incremental, event-driven graph ───────────────────────────────────────────

/**
 * Event-driven incremental code graph. `seed()` does the ONE full walk; after that the
 * watcher feeds it single changed paths via `applyChange()`, which re-reads only that one
 * file (stat-gated by mtime+size — no-op if unchanged) and never re-walks the tree. The
 * stored representation (per-file specifiers) lives in memory; `snapshot()` re-resolves
 * edges from it cheaply (no disk I/O). Non-source / ignored / vanished paths are handled
 * without ever reading them, so transient build artifacts can't drag the watcher in.
 */
export function createIncrementalCodeGraph(rootOrRoots: string | string[], base?: string) {
  const roots = (Array.isArray(rootOrRoots) ? rootOrRoots : [rootOrRoots]).map((r) => toPosix(resolve(r)));
  const baseDir = toPosix(base ? resolve(base) : roots.length === 1 ? roots[0] : commonAncestor(roots));

  const metaByPath = new Map<string, FileMeta>();
  const specsByPath = new Map<string, Set<string>>();
  let aliases: Alias[] = [];
  let goModulePath: string | null = null;

  function loadConfig(): void {
    aliases = [];
    for (const root of roots) {
      const rootRel = toPosix(relative(baseDir, root));
      for (const a of loadTsAliases(root)) {
        aliases.push({ from: a.from, to: [rootRel, a.to].filter(Boolean).join("/") });
      }
    }
    goModulePath = roots.map(loadGoModule).find(Boolean) ?? loadGoModule(baseDir);
  }

  /** Matches walk()/scanCodeFiles() filtering: dotfiles, skip-dirs, .d.ts, non-source ext. */
  function isIgnoredRel(rel: string): boolean {
    const segs = rel.split("/");
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (!s || s.startsWith(".")) return true;
      if (i < segs.length - 1 && SKIP_DIRS.has(s)) return true;
    }
    const name = segs[segs.length - 1];
    if (name.endsWith(".d.ts")) return true;
    return !allExtensions().has(extname(name).toLowerCase());
  }

  /** Map an absolute path under a root to its base-relative meta — or null if not indexable. */
  function locate(abs: string): { path: string; root: string | null } | null {
    const a = toPosix(resolve(abs));
    for (const root of roots) {
      if (a === root || a.startsWith(`${root}/`)) {
        const rel = a.slice(root.length).replace(/^\/+/, "");
        if (isIgnoredRel(rel)) return null;
        return { path: toPosix(relative(baseDir, a)), root: toPosix(relative(baseDir, root)) || null };
      }
    }
    return null;
  }

  /** Resolve the current in-memory model into a snapshot (cheap — no disk reads). */
  function snapshot(): CodeGraphSnapshot {
    const ctx: ResolveCtx = { fileSet: new Set(metaByPath.keys()), tsAliases: aliases, goModulePath };
    const metas = [...metaByPath.values()].sort((a, b) => a.path.localeCompare(b.path));
    const edges: { from: string; to: string }[] = [];
    for (const m of metas) {
      const resolver = resolverForPath(m.path);
      if (!resolver) continue;
      const specs = specsByPath.get(m.path) ?? new Set();
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
    return { files, edges };
  }

  /** Full initial walk + extract — the only tree scan. Time-sliced like build(). */
  async function seed(): Promise<CodeGraphSnapshot> {
    const onYield = makeYielder();
    const { metas, ctx } = await scanRoots(rootOrRoots, base, onYield);
    metaByPath.clear();
    specsByPath.clear();
    for (const m of metas) {
      await onYield();
      metaByPath.set(m.path, m);
      specsByPath.set(m.path, await extractSpecifiers(m));
    }
    aliases = ctx.tsAliases ?? [];
    goModulePath = ctx.goModulePath ?? null;
    return snapshot();
  }

  /**
   * Apply a single filesystem change. Returns true if the in-memory model changed (so the
   * caller should re-snapshot + persist). Re-reads at most ONE file; a tsconfig/go.mod edit
   * reloads aliases; a vanished/ignored path is handled without any read.
   */
  async function applyChange(abs: string): Promise<boolean> {
    const a = toPosix(resolve(abs));
    if (!roots.some((root) => a === root || a.startsWith(`${root}/`))) return false;

    const name = a.split("/").pop() ?? "";
    if (name === "tsconfig.json" || name === "go.mod") {
      const dir = a.slice(0, a.length - name.length - 1);
      if (roots.includes(dir)) {
        loadConfig();
        return true; // alias/module changes can re-resolve existing specifiers
      }
      return false;
    }

    const info = locate(abs);
    if (!info) return false; // not an indexable source file → ignore without reading

    let st;
    try {
      st = await stat(a);
    } catch {
      // vanished
      const had = metaByPath.delete(info.path);
      specsByPath.delete(info.path);
      return had;
    }

    const prev = metaByPath.get(info.path);
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) return false; // mtime gate

    const meta: FileMeta = { path: info.path, abs: a, root: info.root, mtimeMs: st.mtimeMs, size: st.size };
    metaByPath.set(info.path, meta);
    specsByPath.set(info.path, await extractSpecifiers(meta));
    return true;
  }

  return { seed, applyChange, snapshot };
}
