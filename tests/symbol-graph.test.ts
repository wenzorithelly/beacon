import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { codeFile, codeSymbol, codeSymbolEdge, syncState } from "@/lib/drizzle/schema";
import { applySymbolGraphPatch, ingestSymbolGraph, resolveSymbolSnapshot, type SymbolSnapshot } from "@/lib/symbol-graph";

async function resetSymbolGraph() {
  await db.delete(codeSymbolEdge);
  await db.delete(codeSymbol);
  await db.delete(codeFile);
  await db.delete(syncState);
}
beforeEach(resetSymbolGraph);

// codeSymbol.path FK → CodeFile.path — every fixture path needs a row here first.
async function seedFiles(paths: string[]) {
  for (const path of paths) await db.insert(codeFile).values({ path });
}

const classRow = { id: "a.ts::Foo@1", path: "a.ts", name: "Foo", qualifiedName: "Foo", kind: "class" as const, line: 1, endLine: 5, exported: true, parentId: null };
const methodRow = { id: "a.ts::Foo.method@2", path: "a.ts", name: "method", qualifiedName: "Foo.method", kind: "method" as const, line: 2, endLine: 4, exported: false, parentId: classRow.id };
const helperRow = { id: "b.ts::helper@1", path: "b.ts", name: "helper", qualifiedName: "helper", kind: "function" as const, line: 1, endLine: 1, exported: true, parentId: null };
const callEdge = { fromId: methodRow.id, toId: helperRow.id, relation: "calls" as const, confidence: "EXTRACTED" as const, line: 3 };

describe("ingestSymbolGraph", () => {
  it("inserts symbols (parents before members) and edges, and stamps symbolGraphSyncedAt", async () => {
    await seedFiles(["a.ts", "b.ts"]);
    const r = await ingestSymbolGraph({ symbols: [methodRow, classRow, helperRow], edges: [callEdge] });
    expect(r).toMatchObject({ symbols: 3, edges: 1 });
    expect(typeof r.version).toBe("number");

    const rows = await db.query.codeSymbol.findMany();
    expect(rows.map((r) => r.id).sort()).toEqual([classRow.id, helperRow.id, methodRow.id].sort());
    expect(await db.query.codeSymbolEdge.findFirst()).toMatchObject({ fromId: methodRow.id, toId: helperRow.id, confidence: "EXTRACTED" });

    const sync = await db.query.syncState.findFirst({ where: (t, { eq }) => eq(t.id, "singleton") });
    expect(sync?.symbolGraphSyncedAt).toBeInstanceOf(Date);
  });

  it("full-replaces on a second call — a symbol dropped from the snapshot disappears", async () => {
    await seedFiles(["a.ts", "b.ts"]);
    await ingestSymbolGraph({ symbols: [classRow, methodRow, helperRow], edges: [callEdge] });
    await ingestSymbolGraph({ symbols: [classRow], edges: [] });

    const rows = await db.query.codeSymbol.findMany();
    expect(rows.map((r) => r.id)).toEqual([classRow.id]);
    expect(await db.query.codeSymbolEdge.findMany()).toEqual([]);
  });

  it("cascades: deleting the owning CodeFile drops its symbols and edges", async () => {
    await seedFiles(["a.ts", "b.ts"]);
    await ingestSymbolGraph({ symbols: [classRow, methodRow, helperRow], edges: [callEdge] });

    await db.delete(codeFile).where(eq(codeFile.path, "a.ts"));

    const rows = await db.query.codeSymbol.findMany();
    expect(rows.map((r) => r.id)).toEqual([helperRow.id]); // Foo + Foo.method gone with a.ts
    expect(await db.query.codeSymbolEdge.findMany()).toEqual([]); // the calls edge cascaded too
  });
});

describe("applySymbolGraphPatch", () => {
  it("with prev: null, behaves exactly like ingestSymbolGraph", async () => {
    await seedFiles(["a.ts", "b.ts"]);
    const next: SymbolSnapshot = resolveSymbolSnapshot({ symbols: [classRow, methodRow, helperRow], edges: [callEdge] });
    const r = await applySymbolGraphPatch(null, next);
    expect(r).toMatchObject({ symbols: 3, edges: 1 });
    expect((await db.query.codeSymbol.findMany()).length).toBe(3);
  });

  it("applies a minimal diff: adds a new symbol, drops a removed one, leaves the rest untouched", async () => {
    await seedFiles(["a.ts", "b.ts", "c.ts"]);
    const prev = resolveSymbolSnapshot({ symbols: [classRow, methodRow, helperRow], edges: [callEdge] });
    await applySymbolGraphPatch(null, prev);

    const newRow = { id: "c.ts::extra@1", path: "c.ts", name: "extra", qualifiedName: "extra", kind: "function" as const, line: 1, endLine: 1, exported: true, parentId: null };
    const next = resolveSymbolSnapshot({ symbols: [classRow, methodRow, newRow], edges: [] }); // helper + its call edge dropped, extra added
    const r = await applySymbolGraphPatch(prev, next);
    expect(r).toMatchObject({ symbols: 3, edges: 0 });

    const rows = await db.query.codeSymbol.findMany();
    expect(rows.map((r) => r.id).sort()).toEqual([classRow.id, methodRow.id, newRow.id].sort());
    expect(await db.query.codeSymbolEdge.findMany()).toEqual([]);
  });

  it("reinserts unchanged members/edges cascade-dropped by a changed parent row", async () => {
    // Foo's own row changes (exported flips) while its method + the method's call edge do not —
    // deleting Foo to reinsert it would cascade away method+edge unless the patch accounts for it.
    await seedFiles(["a.ts", "b.ts"]);
    const prev = resolveSymbolSnapshot({ symbols: [classRow, methodRow, helperRow], edges: [callEdge] });
    await applySymbolGraphPatch(null, prev);

    const changedClass = { ...classRow, exported: false };
    const next = resolveSymbolSnapshot({ symbols: [changedClass, methodRow, helperRow], edges: [callEdge] });
    const r = await applySymbolGraphPatch(prev, next);
    expect(r).toMatchObject({ symbols: 3, edges: 1 });

    const rows = await db.query.codeSymbol.findMany();
    expect(rows.map((r) => r.id).sort()).toEqual([classRow.id, helperRow.id, methodRow.id].sort());
    expect(rows.find((r) => r.id === classRow.id)).toMatchObject({ exported: false });
    // the method survived the parent's delete+reinsert
    expect(rows.find((r) => r.id === methodRow.id)).toMatchObject({ parentId: classRow.id });
    // ...and so did the edge that pointed at it
    expect(await db.query.codeSymbolEdge.findMany()).toHaveLength(1);
  });

  it("updates an edge's confidence/line in place without touching its endpoints", async () => {
    await seedFiles(["a.ts", "b.ts"]);
    const prev = resolveSymbolSnapshot({ symbols: [classRow, methodRow, helperRow], edges: [callEdge] });
    await applySymbolGraphPatch(null, prev);

    const movedEdge = { ...callEdge, line: 99, confidence: "INFERRED" as const };
    const next = resolveSymbolSnapshot({ symbols: [classRow, methodRow, helperRow], edges: [movedEdge] });
    await applySymbolGraphPatch(prev, next);

    const edge = await db.query.codeSymbolEdge.findFirst();
    expect(edge).toMatchObject({ line: 99, confidence: "INFERRED" });
    expect((await db.query.codeSymbol.findMany()).length).toBe(3); // symbols untouched
  });
});
