import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "bun:test";
import { extractFileSymbols, loadSymbolParsers, type SymbolParsers } from "@/intel/extractors/symbols";

const FIX = "tests/fixtures/symbols";

let parsers: SymbolParsers;
beforeAll(async () => {
  const p = await loadSymbolParsers();
  if (!p) throw new Error("tree-sitter wasm failed to load — set BEACON_TREE_SITTER_DIR");
  parsers = p;
});

async function extract(path: string) {
  const src = await readFile(path, "utf8");
  return extractFileSymbols(parsers, path, null, src);
}

function byName(rows: { name: string }[], name: string) {
  return rows.find((r) => r.name === name);
}

describe("extractFileSymbols — TypeScript", () => {
  it("captures class heritage, methods, functions, exported flags, and qualifiedName", async () => {
    const fs = await extract(`${FIX}/a.ts`);
    const names = fs.symbols.map((s) => s.name).sort();
    expect(names).toEqual(["Base", "Foo", "IFace", "method", "sameFileFn"].sort());

    const iface = byName(fs.symbols, "IFace")!;
    expect(iface).toMatchObject({ kind: "type", line: 3, endLine: 3, exported: false, parentId: null });

    const foo = byName(fs.symbols, "Foo")!;
    expect(foo).toMatchObject({ kind: "class", line: 7, exported: true, parentId: null, qualifiedName: "Foo" });

    const method = byName(fs.symbols, "method")!;
    expect(method).toMatchObject({ kind: "method", qualifiedName: "Foo.method", parentId: foo.id, exported: false });

    const fn = byName(fs.symbols, "sameFileFn")!;
    expect(fn).toMatchObject({ kind: "function", exported: false, parentId: null });
  });

  it("records extends/implements refs on the class itself and calls on the method", async () => {
    const fs = await extract(`${FIX}/a.ts`);
    const foo = byName(fs.symbols, "Foo")!;
    const method = byName(fs.symbols, "method")!;

    expect(fs.refs).toContainEqual({ fromId: foo.id, name: "Base", relation: "extends", line: 7 });
    expect(fs.refs).toContainEqual({ fromId: foo.id, name: "IFace", relation: "implements", line: 7 });
    expect(fs.refs).toContainEqual({ fromId: method.id, name: "sameFileFn", relation: "calls", line: 9 });
    expect(fs.refs).toContainEqual({ fromId: method.id, name: "importedFn", relation: "calls", line: 10 });
  });

  it("maps the named import to its module specifier", async () => {
    const fs = await extract(`${FIX}/a.ts`);
    expect(fs.imports.get("importedFn")).toBe("./b");
  });
});

describe("extractFileSymbols — Python", () => {
  it("marks methods vs functions, leading-underscore privacy, and self.-call refs", async () => {
    const fs = await extract(`${FIX}/sample.py`);
    const foo = byName(fs.symbols, "Foo")!;
    const method = byName(fs.symbols, "method")!;
    const helper = byName(fs.symbols, "helper")!;
    const topLevel = byName(fs.symbols, "top_level")!;
    const priv = byName(fs.symbols, "_private")!;

    expect(foo).toMatchObject({ kind: "class", line: 5, exported: true });
    expect(method).toMatchObject({ kind: "method", qualifiedName: "Foo.method", parentId: foo.id, line: 6 });
    expect(helper).toMatchObject({ kind: "method", qualifiedName: "Foo.helper", parentId: foo.id });
    expect(topLevel).toMatchObject({ kind: "function", parentId: null, exported: true });
    expect(priv).toMatchObject({ kind: "function", exported: false });

    expect(fs.refs).toContainEqual({ fromId: foo.id, name: "Base", relation: "extends", line: 5 });
    expect(fs.refs).toContainEqual({ fromId: method.id, name: "helper", relation: "calls", line: 7, self: true });
    expect(fs.refs).toContainEqual({ fromId: method.id, name: "top_level", relation: "calls", line: 8 });
  });
});

describe("extractFileSymbols — Go", () => {
  it("keys methods to their receiver type and reads capitalisation as exported", async () => {
    const fs = await extract(`${FIX}/sample.go`);
    const base = byName(fs.symbols, "Base")!;
    const method = byName(fs.symbols, "Method")!;
    const other = byName(fs.symbols, "Other")!;
    const unexported = byName(fs.symbols, "unexported")!;

    expect(base).toMatchObject({ kind: "class", exported: true, line: 3 });
    expect(method).toMatchObject({ kind: "method", qualifiedName: "Base.Method", parentId: base.id });
    expect(other).toMatchObject({ kind: "method", qualifiedName: "Base.Other", parentId: base.id });
    expect(unexported).toMatchObject({ kind: "function", exported: false });

    expect(fs.refs).toContainEqual({ fromId: method.id, name: "Helper", relation: "calls", line: 10 });
    expect(fs.refs).toContainEqual({ fromId: method.id, name: "Other", relation: "calls", line: 11, via: "b" });
  });
});

describe("extractFileSymbols — Rust", () => {
  it("keys impl-block fns to their struct, reads pub as exported, and links impl Trait for X", async () => {
    const fs = await extract(`${FIX}/sample.rs`);
    const point = byName(fs.symbols, "Point")!;
    const shape = byName(fs.symbols, "Shape")!;
    const area = byName(fs.symbols, "area")!;
    const helper = byName(fs.symbols, "helper")!;
    const topLevel = byName(fs.symbols, "top_level")!;

    expect(point).toMatchObject({ kind: "class", exported: true }); // `pub struct`
    expect(shape).toMatchObject({ kind: "class", exported: false }); // no `pub`
    expect(area).toMatchObject({ kind: "method", qualifiedName: "Point.area", parentId: point.id });
    expect(helper).toMatchObject({ kind: "method", qualifiedName: "Point.helper", parentId: point.id });
    expect(topLevel).toMatchObject({ kind: "function", parentId: null });

    expect(fs.refs).toContainEqual({ fromId: point.id, name: "Shape", relation: "implements", line: 9 });
    expect(fs.refs).toContainEqual({ fromId: area.id, name: "helper", relation: "calls", line: 11, self: true });
    expect(fs.refs).toContainEqual({ fromId: area.id, name: "top_level", relation: "calls", line: 12 });
  });
});

describe("extractFileSymbols — unsupported files", () => {
  it("returns an empty result instead of throwing", () => {
    const fs = extractFileSymbols(parsers, "README.md", null, "# hello\n");
    expect(fs).toEqual({ path: "README.md", symbols: [], refs: [], imports: new Map() });
  });
});

describe("extractFileSymbols — review fixes (2026-09-07)", () => {
  it("a member call carries its receiver: `this.x()` is self, `ns.x()` names the binding", async () => {
    const fs = await extract(`${FIX}/siblings.ts`);
    const call = fs.refs.find((r) => r.name === "render");
    expect(call?.self).toBe(true);
    expect(call?.via).toBeUndefined();
    const ns = await extract(`${FIX}/ns.ts`);
    const viaCall = ns.refs.find((r) => r.name === "importedFn");
    expect(viaCall?.via).toBe("b");
    expect(ns.imports.get("b")).toBe("./b"); // namespace import binds the module under `b`
  });
  it("decorated Python defs inside a class are still methods with a Class.name", async () => {
    const fs = await extract(`${FIX}/sample.py`);
    const util = byName(fs.symbols, "util");
    expect(util?.kind).toBe("method");
    expect(util?.qualifiedName).toBe("Decorated.util");
    expect(byName(fs.symbols, "value")?.qualifiedName).toBe("Decorated.value");
  });
  it("Go: a method declared above its type still gets the type as parent, and imports bind packages", async () => {
    const fs = await extract(`${FIX}/order.go`);
    const early = byName(fs.symbols, "Early")!;
    const m = byName(fs.symbols, "M")!;
    expect(m.parentId).toBe(early.id);
    expect(fs.imports.get("fmt")).toBe("fmt");
    expect(fs.imports.get("str")).toBe("strings"); // aliased import binds the alias
    expect(fs.refs.find((r) => r.name === "Println")?.via).toBe("fmt");
  });
});
