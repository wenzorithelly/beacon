import { readFile } from "node:fs/promises";
import { describe, expect, it } from "bun:test";
import { resolveSymbolEdges } from "@/intel/extractors/symbol-resolve";
import type { FileSymbols, SymbolRow } from "@/intel/extractors/symbols";
import { extractFileSymbols, loadSymbolParsers } from "@/intel/extractors/symbols";
import { resolverForPath } from "@/intel/extractors/languages";

function sym(path: string, name: string, opts: Partial<SymbolRow> = {}): SymbolRow {
  return {
    id: `${path}::${name}@1`,
    path,
    name,
    qualifiedName: name,
    kind: "function",
    line: 1,
    endLine: 1,
    exported: true,
    parentId: null,
    ...opts,
  };
}

function file(path: string, symbols: SymbolRow[], refs: FileSymbols["refs"] = [], imports: [string, string][] = []): FileSymbols {
  return { path, symbols, refs, imports: new Map(imports) };
}

const noImports = () => null;

describe("resolveSymbolEdges — hand-built scenarios", () => {
  it("resolves a same-file call as EXTRACTED", () => {
    const target = sym("a.ts", "helper");
    const files = new Map([
      ["a.ts", file("a.ts", [sym("a.ts", "caller"), target], [{ fromId: "a.ts::caller@1", name: "helper", relation: "calls", line: 5 }])],
    ]);
    const edges = resolveSymbolEdges(files, noImports);
    expect(edges).toEqual([{ fromId: "a.ts::caller@1", toId: target.id, relation: "calls", confidence: "EXTRACTED", line: 5 }]);
  });

  it("resolves an imported call as EXTRACTED via resolveImport", () => {
    const target = sym("b.ts", "helper");
    const files = new Map([
      ["a.ts", file("a.ts", [sym("a.ts", "caller")], [{ fromId: "a.ts::caller@1", name: "helper", relation: "calls", line: 5 }], [["helper", "./b"]])],
      ["b.ts", file("b.ts", [target])],
    ]);
    const resolveImport = (fromPath: string, specifier: string) => (fromPath === "a.ts" && specifier === "./b" ? "b.ts" : null);
    const edges = resolveSymbolEdges(files, resolveImport);
    expect(edges).toEqual([{ fromId: "a.ts::caller@1", toId: target.id, relation: "calls", confidence: "EXTRACTED", line: 5 }]);
  });

  it("falls back to INFERRED when exactly one symbol with that name exists anywhere", () => {
    const target = sym("c.ts", "onlyHere");
    const files = new Map([
      ["a.ts", file("a.ts", [sym("a.ts", "caller")], [{ fromId: "a.ts::caller@1", name: "onlyHere", relation: "calls", line: 5 }])],
      ["c.ts", file("c.ts", [target])],
    ]);
    const edges = resolveSymbolEdges(files, noImports);
    expect(edges).toEqual([{ fromId: "a.ts::caller@1", toId: target.id, relation: "calls", confidence: "INFERRED", line: 5 }]);
  });

  it("emits no edge when the name is ambiguous across files", () => {
    const files = new Map([
      ["a.ts", file("a.ts", [sym("a.ts", "caller")], [{ fromId: "a.ts::caller@1", name: "dup", relation: "calls", line: 5 }])],
      ["b.ts", file("b.ts", [sym("b.ts", "dup")])],
      ["c.ts", file("c.ts", [sym("c.ts", "dup")])],
    ]);
    const edges = resolveSymbolEdges(files, noImports);
    expect(edges).toEqual([]);
  });

  it("never emits a self-edge", () => {
    const files = new Map([
      ["a.ts", file("a.ts", [sym("a.ts", "recurse")], [{ fromId: "a.ts::recurse@1", name: "recurse", relation: "calls", line: 5 }])],
    ]);
    const edges = resolveSymbolEdges(files, noImports);
    expect(edges).toEqual([]);
  });

  it("drops module-level refs (fromId: null)", () => {
    const files = new Map([
      ["a.ts", file("a.ts", [sym("a.ts", "helper")], [{ fromId: null, name: "helper", relation: "calls", line: 5 }])],
    ]);
    expect(resolveSymbolEdges(files, noImports)).toEqual([]);
  });

  it("prefers a same-file top-level symbol over a member with the same name", () => {
    const topLevel = sym("a.ts", "helper", { parentId: null });
    const member = sym("a.ts", "helper", { id: "a.ts::Other.helper@9", qualifiedName: "Other.helper", parentId: "a.ts::Other@8" });
    const files = new Map([
      ["a.ts", file("a.ts", [topLevel, member], [{ fromId: "a.ts::caller@1", name: "helper", relation: "calls", line: 5 }])],
    ]);
    const edges = resolveSymbolEdges(files, noImports);
    expect(edges).toEqual([{ fromId: "a.ts::caller@1", toId: topLevel.id, relation: "calls", confidence: "EXTRACTED", line: 5 }]);
  });

  it("dedupes repeat refs to the same edge, keeping the lowest line", () => {
    const target = sym("a.ts", "helper");
    const files = new Map([
      [
        "a.ts",
        file("a.ts", [sym("a.ts", "caller"), target], [
          { fromId: "a.ts::caller@1", name: "helper", relation: "calls", line: 9 },
          { fromId: "a.ts::caller@1", name: "helper", relation: "calls", line: 3 },
        ]),
      ],
    ]);
    const edges = resolveSymbolEdges(files, noImports);
    expect(edges).toEqual([{ fromId: "a.ts::caller@1", toId: target.id, relation: "calls", confidence: "EXTRACTED", line: 3 }]);
  });
});

describe("resolveSymbolEdges — end-to-end over the TS fixtures", () => {
  it("matches extract → resolve exactly the way the watcher would run it", async () => {
    const parsers = await loadSymbolParsers();
    if (!parsers) throw new Error("tree-sitter wasm failed to load");
    const paths = ["tests/fixtures/symbols/a.ts", "tests/fixtures/symbols/b.ts", "tests/fixtures/symbols/c.ts"];
    const fileSet = new Set(paths);
    const files = new Map<string, FileSymbols>();
    for (const p of paths) files.set(p, extractFileSymbols(parsers, p, "ts", await readFile(p, "utf8")));

    const resolveImport = (fromPath: string, specifier: string) => {
      const resolver = resolverForPath(fromPath);
      if (!resolver) return null;
      return resolver.resolve(specifier, fromPath, { fileSet, tsAliases: [] })[0] ?? null;
    };
    const edges = resolveSymbolEdges(files, resolveImport);
    const byRelationAndName = edges.map((e) => ({ toId: e.toId, relation: e.relation, confidence: e.confidence }));

    // same-file EXTRACTED (extends + implements + a plain call)
    expect(byRelationAndName).toContainEqual({ toId: "tests/fixtures/symbols/a.ts::Base@5", relation: "extends", confidence: "EXTRACTED" });
    expect(byRelationAndName).toContainEqual({ toId: "tests/fixtures/symbols/a.ts::IFace@3", relation: "implements", confidence: "EXTRACTED" });
    expect(byRelationAndName).toContainEqual({ toId: "tests/fixtures/symbols/a.ts::sameFileFn@16", relation: "calls", confidence: "EXTRACTED" });
    // cross-file EXTRACTED via the real import map + real tsResolver
    expect(byRelationAndName).toContainEqual({ toId: "tests/fixtures/symbols/b.ts::importedFn@1", relation: "calls", confidence: "EXTRACTED" });
    // globally-unique fallback → INFERRED
    expect(byRelationAndName).toContainEqual({ toId: "tests/fixtures/symbols/c.ts::inferredOnly@1", relation: "calls", confidence: "INFERRED" });
    // "ambiguousName" is defined in both b.ts and c.ts — no edge at all
    expect(edges.some((e) => e.toId.includes("ambiguousName"))).toBe(false);
    expect(edges).toHaveLength(5);
  });
});

describe("resolveSymbolEdges — receiver-aware tiers (2026-09-07)", () => {
  it("`this.render()` in the second class binds to ITS OWN render, not the first class's", () => {
    const first = sym("s.ts", "First", { kind: "class", id: "s.ts::First@1" });
    const firstRender = sym("s.ts", "render", { kind: "method", qualifiedName: "First.render", id: "s.ts::First.render@2", parentId: first.id });
    const second = sym("s.ts", "Second", { kind: "class", id: "s.ts::Second@5" });
    const secondRender = sym("s.ts", "render", { kind: "method", qualifiedName: "Second.render", id: "s.ts::Second.render@6", parentId: second.id });
    const paint = sym("s.ts", "paint", { kind: "method", qualifiedName: "Second.paint", id: "s.ts::Second.paint@7", parentId: second.id });
    const files = new Map([[
      "s.ts",
      file("s.ts", [first, firstRender, second, secondRender, paint], [{ fromId: paint.id, name: "render", relation: "calls", line: 8, self: true }]),
    ]]);
    const edges = resolveSymbolEdges(files, noImports);
    expect(edges).toEqual([{ fromId: paint.id, toId: secondRender.id, relation: "calls", confidence: "EXTRACTED", line: 8 }]);
  });
  it("`ns.fn()` follows the namespace binding's import, even when the file has its own fn", () => {
    const local = sym("a.ts", "write");
    const caller = sym("a.ts", "save");
    const remote = sym("db.ts", "write");
    const files = new Map([
      ["a.ts", file("a.ts", [local, caller], [{ fromId: caller.id, name: "write", relation: "calls", line: 3, via: "db" }], [["db", "./db"]])],
      ["db.ts", file("db.ts", [remote])],
    ]);
    const edges = resolveSymbolEdges(files, (from, spec) => (from === "a.ts" && spec === "./db" ? "db.ts" : null));
    expect(edges.map((e) => e.toId)).toEqual([remote.id]);
    expect(edges[0].confidence).toBe("EXTRACTED");
  });
});
