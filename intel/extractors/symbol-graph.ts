import { readFile } from "node:fs/promises";
import { extractFileSymbols, loadSymbolParsers, type FileSymbols, type SymbolRow } from "./symbols";
import { resolveSymbolEdges, type SymbolEdgeRow } from "./symbol-resolve";
import { edgeKey } from "./symbol-types";

// Event-driven incremental symbol graph — the symbol-layer analogue of
// intel/extractors/code-graph.ts's createIncrementalCodeGraph. Same shape: seed() does the one
// full pass, applyChange() re-extracts a single file and re-resolves edges (cheap, in-memory —
// see symbol-resolve's own note on that). The caller (intel/watch-inline.ts) owns the file
// roster; this module only extracts + resolves it into a persistable snapshot.

export interface SymbolSnapshot {
  symbols: Map<string, SymbolRow>;
  edges: Map<string, SymbolEdgeRow>;
}

/** One file the symbol grapher should track: `abs` to read, `path` for the CodeSymbol FK. */
export interface SymbolGraphFile {
  abs: string;
  path: string;
  lang: string | null;
}

export interface CreateSymbolGraphOptions {
  /** The CURRENT file roster (the caller's file-graph snapshot, re-queried on every call). */
  files: () => Iterable<SymbolGraphFile>;
  /** Same per-language import resolver the file-import graph uses for its own edges. */
  resolveImport: (fromPath: string, specifier: string) => string | null;
}

export function createIncrementalSymbolGraph({ files, resolveImport }: CreateSymbolGraphOptions) {
  // Extracted-per-file cache, keyed by repo-relative path. `absByPath` lets applyChange() tell a
  // deleted file (no longer in files()) from an unrelated path (never was one) without needing
  // the caller to say which.
  const byPath = new Map<string, FileSymbols>();
  const absByPath = new Map<string, string>();

  function snapshotFromCache(): SymbolSnapshot {
    const symbols = new Map<string, SymbolRow>();
    for (const fs of byPath.values()) for (const s of fs.symbols) symbols.set(s.id, s);
    const edges = new Map<string, SymbolEdgeRow>();
    for (const e of resolveSymbolEdges(byPath, resolveImport)) edges.set(edgeKey(e.fromId, e.toId, e.relation), e);
    return { symbols, edges };
  }

  async function extractOne(f: SymbolGraphFile): Promise<void> {
    const parsers = await loadSymbolParsers();
    if (!parsers) {
      byPath.delete(f.path); // wasm unavailable — never break the caller, just carry no symbols
      return;
    }
    let content: string;
    try {
      content = await readFile(f.abs, "utf8");
    } catch {
      byPath.delete(f.path); // vanished between listing and read
      return;
    }
    byPath.set(f.path, extractFileSymbols(parsers, f.path, f.lang, content));
  }

  async function seed(): Promise<SymbolSnapshot> {
    byPath.clear();
    absByPath.clear();
    for (const f of files()) {
      absByPath.set(f.path, f.abs);
      await extractOne(f);
    }
    return snapshotFromCache();
  }

  /**
   * Re-extract the one file at `abs` (or drop it if it no longer exists). Returns whether the
   * cache changed — false for a path this grapher never tracked (the file graph reports every
   * change on the tree, most of which aren't symbol-relevant). Resolution is NOT run here: a
   * checkout or formatter run reports many files in one tick, and edges are re-resolved once, by
   * `snapshot()`, after every changed file is in.
   */
  async function applyChange(abs: string): Promise<boolean> {
    for (const f of files()) {
      if (f.abs !== abs) continue;
      absByPath.set(f.path, f.abs);
      await extractOne(f);
      return true;
    }
    for (const [path, a] of absByPath) {
      if (a !== abs) continue;
      absByPath.delete(path);
      return byPath.delete(path);
    }
    return false; // not a file this grapher has ever tracked
  }

  /** Resolve the cache into a persistable snapshot — one full edge resolution. */
  function snapshot(): SymbolSnapshot {
    return snapshotFromCache();
  }

  return { seed, applyChange, snapshot };
}
