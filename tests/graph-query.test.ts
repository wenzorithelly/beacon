import { describe, expect, it } from "bun:test";
import { affectedBy, buildGraph, explainNode, graphStats, queryGraph, shortestPath, type BuildGraphInput } from "@/lib/graph-query";

// Small builders — avoid retyping the full CodeSymbol/CodeSymbolEdge row shape everywhere.
function sym(
  path: string,
  name: string,
  line: number,
  opts: Partial<{ qualifiedName: string; kind: string; endLine: number; exported: boolean; parentId: string | null }> = {},
) {
  const qualifiedName = opts.qualifiedName ?? name;
  return {
    id: `${path}::${qualifiedName}@${line}`,
    path,
    name,
    qualifiedName,
    kind: opts.kind ?? "function",
    line,
    endLine: opts.endLine ?? line + 1,
    exported: opts.exported ?? true,
    parentId: opts.parentId ?? null,
  };
}
function edge(fromId: string, toId: string, relation: string, opts: Partial<{ confidence: string; line: number | null }> = {}) {
  return { fromId, toId, relation, confidence: opts.confidence ?? "EXTRACTED", line: opts.line ?? null };
}

describe("buildGraph", () => {
  it("adds contains (file→symbol) and member (parent→child) edges alongside the real ones", () => {
    const foo = sym("a.ts", "Foo", 1, { kind: "class" });
    const bar = sym("a.ts", "bar", 2, { kind: "method", qualifiedName: "Foo.bar", parentId: foo.id });
    const g = buildGraph({ symbols: [foo, bar], symbolEdges: [], files: [{ path: "a.ts" }], fileEdges: [] });
    expect(g.out.get("a.ts")?.map((e) => e.relation)).toContain("contains");
    expect(g.out.get(foo.id)?.map((e) => e.relation)).toContain("member");
  });
});

describe("queryGraph — scoring", () => {
  const symbols = [
    // "helperoid" is one un-split word (no camelCase/snake_case boundary) sharing only a PREFIX
    // with "helper" — unlike "helperUtils", which would camel-split into a part that's an EXACT
    // match for the term "helper" and tie with it, defeating the point of this test.
    sym("x.ts", "helper", 1),
    sym("x.ts", "helperoid", 3),
    sym("x.ts", "orderTotal", 5),
    sym("x.ts", "order", 7),
  ];
  const input: BuildGraphInput = { symbols, symbolEdges: [], files: [{ path: "x.ts" }], fileEdges: [] };
  const g = buildGraph(input);

  it("picks the exact-name node as the sole/first seed over a mere prefix match", () => {
    const r = queryGraph(g, "What does helper do?");
    if (!("seeds" in r)) throw new Error("expected a match");
    expect(r.seeds[0]).toBe("helper");
    expect(r.seeds).not.toContain("helperoid");
  });

  it("a node covering every query term outranks one with a single isolated exact hit", () => {
    // "orderTotal" matches BOTH "order" and "total" (via camelCase parts); "order" alone matches
    // only "order" — full coverage should win even though "order" also gets an exact hit.
    const r = queryGraph(g, "order total");
    if (!("seeds" in r)) throw new Error("expected a match");
    expect(r.seeds).toEqual(["orderTotal"]);
  });

  it("returns a no-match message (not an error) when nothing scores", () => {
    const r = queryGraph(g, "zzz nomatch");
    expect(r.text).toContain("No symbol matches");
  });
});

describe("queryGraph — hub cut-off", () => {
  const callers = Array.from({ length: 55 }, (_, i) => sym("callers.ts", `caller${i}`, i + 1));
  const symbols = [sym("hub.ts", "entrypoint", 1), sym("hub.ts", "hubfn", 3), ...callers];
  const symbolEdges = [
    edge("hub.ts::entrypoint@1", "hub.ts::hubfn@3", "calls"),
    ...callers.map((c) => edge(c.id, "hub.ts::hubfn@3", "calls")),
  ];
  const g = buildGraph({ symbols, symbolEdges, files: [{ path: "hub.ts" }, { path: "callers.ts" }], fileEdges: [] });

  it("never expands THROUGH a hub (degree ≥ p99, floor 50) unless it's a seed", () => {
    const r = queryGraph(g, "entrypoint", { depth: 2 });
    if (!("nodes" in r)) throw new Error("expected a match");
    // hubfn (degree 57) is reached as entrypoint's neighbor, but its 55 callers must NOT surface —
    // reaching them requires expanding FROM hubfn, which is blocked since hubfn isn't a seed.
    expect(r.text).toContain("NODE entrypoint");
    expect(r.text).toContain("NODE hubfn");
    expect(r.text).not.toContain("caller0");
    expect(r.nodes).toHaveLength(3); // entrypoint, hubfn, hub.ts (the containing file)
  });
});

describe("queryGraph — budget truncation", () => {
  const peers = Array.from({ length: 10 }, (_, i) => sym("wide.ts", `peer${i}`, i + 2));
  const seedSym = sym("wide.ts", "seedfn", 1);
  const symbolEdges = peers.map((p) => edge(seedSym.id, p.id, "calls"));
  const g = buildGraph({ symbols: [seedSym, ...peers], symbolEdges, files: [{ path: "wide.ts" }], fileEdges: [] });

  it("always keeps the seed NODE line even when the budget can't fit the rest", () => {
    const r = queryGraph(g, "seedfn", { budget: 5 }); // ~15 chars — smaller than any single line
    if (!("truncated" in r)) throw new Error("expected a match");
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("NODE seedfn");
    expect(r.text).not.toContain("NODE peer0");
    expect(r.text).toMatch(/truncated: 1 of \d+ nodes shown/);
  });
});

// One shared fixture for explain / affected / stats: a class with two methods, a duplicate bare
// name across two files (ambiguity), and a two-hop caller chain (extracted + inferred edges).
function classFixture() {
  const foo = sym("a.ts", "Foo", 1, { kind: "class" });
  const fooBar = sym("a.ts", "bar", 2, { kind: "method", qualifiedName: "Foo.bar", parentId: foo.id });
  const fooBaz = sym("a.ts", "baz", 6, { kind: "method", qualifiedName: "Foo.baz", parentId: foo.id });
  const helper = sym("a.ts", "helper", 10);
  const runA = sym("a.ts", "run", 16);
  const other = sym("b.ts", "Other", 1, { kind: "class" });
  const otherQux = sym("b.ts", "qux", 2, { kind: "method", qualifiedName: "Other.qux", parentId: other.id });
  const runB = sym("b.ts", "run", 9);
  const callerA = sym("callers.ts", "callerA", 1);
  const callerB = sym("callers.ts", "callerB", 5);
  const symbols = [foo, fooBar, fooBaz, helper, runA, other, otherQux, runB, callerA, callerB];
  const symbolEdges = [
    edge(callerA.id, fooBar.id, "calls", { confidence: "EXTRACTED" }),
    edge(callerB.id, callerA.id, "calls", { confidence: "INFERRED" }),
  ];
  const g = buildGraph({ symbols, symbolEdges, files: [{ path: "a.ts" }, { path: "b.ts" }, { path: "callers.ts" }], fileEdges: [] });
  return { g, foo, fooBar, callerA, callerB };
}

describe("explainNode", () => {
  it("refuses an ambiguous bare name that resolves to symbols in different files", () => {
    const { g } = classFixture();
    const r = explainNode(g, "run");
    expect("ambiguous" in r).toBe(true);
    if ("ambiguous" in r) {
      expect(r.text).toContain("a.ts");
      expect(r.text).toContain("b.ts");
    }
  });
});

describe("affectedBy", () => {
  it("groups reverse-blast-radius hits by depth, seeding through the class's own members", () => {
    const { g } = classFixture();
    const r = affectedBy(g, "Foo", { depth: 2 });
    const [beforeD2, afterD2] = r.text.split("depth 2:");
    // callerA calls Foo.bar directly (depth 1); callerB only reaches Foo via callerA (depth 2).
    expect(beforeD2).toContain("callerA");
    expect(afterD2).toContain("callerB");
  });
});

describe("graphStats", () => {
  it("counts symbols/edges/files across the built graph", () => {
    const { g } = classFixture();
    // 10 symbols each get a `contains` edge (10) + 3 `member` edges (Foo.bar/Foo.baz/Other.qux) +
    // the 2 hand-authored `calls` edges = 15 total.
    expect(graphStats(g)).toEqual({ symbols: 10, files: 3, edges: 15, text: "10 symbols · 15 edges · 3 files" });
  });
});

describe("shortestPath", () => {
  const p1 = sym("p.ts", "p1", 1);
  const p2 = sym("p.ts", "p2", 2);
  const p3 = sym("p.ts", "p3", 3);
  const g = buildGraph({
    symbols: [p1, p2, p3],
    symbolEdges: [edge(p1.id, p2.id, "calls"), edge(p2.id, p3.id, "calls")],
    files: [{ path: "p.ts" }],
    fileEdges: [],
  });

  it("finds a directed path forward", () => {
    const r = shortestPath(g, "p1", "p3");
    if (!("path" in r)) throw new Error("expected a path");
    expect(r.path).toEqual([p1.id, p2.id, p3.id]);
    expect(r.text).toContain("p1 --calls [EXTRACTED]--> p2");
  });

  it("refuses a directed path backward and suggests --undirected", () => {
    const r = shortestPath(g, "p3", "p1");
    expect(r.text).toBe("No directed path from p3 to p1. Re-run with --undirected.");
  });

  it("finds the reverse route when undirected", () => {
    const r = shortestPath(g, "p3", "p1", { undirected: true });
    if (!("path" in r)) throw new Error("expected a path");
    expect(r.path).toHaveLength(3);
  });
});
