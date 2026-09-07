import type { FileSymbols, SymbolRow } from "./symbols";
import { edgeKey } from "./symbol-types";
export { edgeKey };

// Turns each file's extracted Refs (bare names, scoped only to the file they were seen in) into
// symbol→symbol edges. Three-tier resolution, in order — same-file, then import-resolved, then
// "only one candidate anywhere" — matching how a reader would actually disambiguate a call.

export interface SymbolEdgeRow {
  fromId: string;
  toId: string;
  relation: "calls" | "extends" | "implements";
  confidence: "EXTRACTED" | "INFERRED";
  line: number;
}

/**
 * Resolve every file's refs into edges. `resolveImport(fromPath, specifier)` should be the same
 * per-language resolver the file-import graph uses (intel/extractors/languages) so a specifier
 * resolves to a file exactly the way its own import edge would.
 *
 * ponytail: full re-resolve on every change — index refs by name if repos get huge
 */
export function resolveSymbolEdges(
  files: Map<string, FileSymbols>,
  resolveImport: (fromPath: string, specifier: string) => string | null,
): SymbolEdgeRow[] {
  // Per-file name indexes (top-level only, and "any member" for the same-file fallback) plus a
  // global name index for the ambiguous/unique fallback.
  const byFileTop = new Map<string, Map<string, SymbolRow>>();
  const byFileAny = new Map<string, Map<string, SymbolRow>>();
  const globalByName = new Map<string, SymbolRow[]>();
  const byId = new Map<string, SymbolRow>();

  for (const [path, fs] of files) {
    const top = new Map<string, SymbolRow>();
    const any = new Map<string, SymbolRow>();
    for (const s of fs.symbols) {
      byId.set(s.id, s);
      if (s.parentId === null) top.set(s.name, s);
      if (!any.has(s.name)) any.set(s.name, s); // first occurrence (document order) wins
      const g = globalByName.get(s.name);
      if (g) g.push(s);
      else globalByName.set(s.name, [s]);
    }
    byFileTop.set(path, top);
    byFileAny.set(path, any);
  }

  const seen = new Map<string, SymbolEdgeRow>(); // dedupe (fromId,toId,relation), keep lowest line
  function addEdge(fromId: string, toId: string, relation: SymbolEdgeRow["relation"], confidence: SymbolEdgeRow["confidence"], line: number) {
    if (fromId === toId) return; // never self-edges
    const key = edgeKey(fromId, toId, relation);
    const existing = seen.get(key);
    if (!existing || line < existing.line) seen.set(key, { fromId, toId, relation, confidence, line });
  }

  /** The class a symbol belongs to — its nearest ancestor of kind "class", if any. */
  function ownerClass(id: string): SymbolRow | undefined {
    for (let s = byId.get(id); s; s = s.parentId ? byId.get(s.parentId) : undefined) {
      if (s.kind === "class") return s;
    }
    return undefined;
  }

  for (const [path, fs] of files) {
    for (const ref of fs.refs) {
      if (!ref.fromId) continue; // module-level ref — we only keep symbol→symbol edges

      // (a0) `this.x()` / `self.x()`: the member of the ENCLOSING class named x — before any
      //      same-file lookup, which would otherwise hand a sibling class's x to every class after it.
      if (ref.self) {
        const owner = ownerClass(ref.fromId);
        const own = owner && fs.symbols.find((s) => s.parentId === owner.id && s.name === ref.name);
        if (own) {
          addEdge(ref.fromId, own.id, ref.relation, "EXTRACTED", ref.line);
          continue;
        }
      }

      // (a1) `ns.x()` where ns is an imported namespace/package/module binding: follow THAT binding
      //      to its file and take the top-level x there — before same-file, which could hold an
      //      unrelated x of its own.
      const viaSpec = ref.via ? fs.imports.get(ref.via) : undefined;
      const viaPath = viaSpec ? resolveImport(path, viaSpec) : null;
      const viaHit = viaPath ? byFileTop.get(viaPath)?.get(ref.name) : undefined;
      if (viaHit) {
        addEdge(ref.fromId, viaHit.id, ref.relation, "EXTRACTED", ref.line);
        continue;
      }

      // (a) same-file: a symbol named `ref.name` defined in this file — top-level preferred.
      const sameFile = byFileTop.get(path)?.get(ref.name) ?? byFileAny.get(path)?.get(ref.name);
      if (sameFile) {
        addEdge(ref.fromId, sameFile.id, ref.relation, "EXTRACTED", ref.line);
        continue;
      }

      // (b) this file imports `ref.name`, and the import resolves to a file that defines it
      //     top-level.
      const specifier = fs.imports.get(ref.name);
      const targetPath = specifier ? resolveImport(path, specifier) : null;
      const imported = targetPath ? byFileTop.get(targetPath)?.get(ref.name) : undefined;
      if (imported) {
        addEdge(ref.fromId, imported.id, ref.relation, "EXTRACTED", ref.line);
        continue;
      }

      // (c) exactly one symbol with this name exists anywhere — inferred, not proven.
      const candidates = globalByName.get(ref.name);
      if (candidates && candidates.length === 1) {
        addEdge(ref.fromId, candidates[0].id, ref.relation, "INFERRED", ref.line);
      }
      // Two or more candidates and no import/same-file hit → too ambiguous, no edge.
    }
  }

  return [...seen.values()];
}
