import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { codeFileEdge, codeFile, syncState } from "@/lib/drizzle/schema";
import { blastRadius, ingestCodeGraph } from "@/lib/code-graph";

async function resetCodeGraph() {
  await db.delete(codeFileEdge);
  await db.delete(codeFile);
  await db.delete(syncState);
}
beforeEach(resetCodeGraph);

describe("ingestCodeGraph — degree caching", () => {
  it("caches inDegree + outDegree per file from the edge list", async () => {
    // a→b, c→b, b→d : b is imported by {a,c} and imports {d}.
    await ingestCodeGraph({
      files: [{ path: "a.ts" }, { path: "b.ts" }, { path: "c.ts" }, { path: "d.ts" }],
      edges: [
        { from: "a.ts", to: "b.ts" },
        { from: "c.ts", to: "b.ts" },
        { from: "b.ts", to: "d.ts" },
      ],
    });
    expect(
      await db.query.codeFile.findFirst({ where: (f, { eq }) => eq(f.path, "b.ts") }),
    ).toMatchObject({
      inDegree: 2,
      outDegree: 1,
    });
    expect(
      await db.query.codeFile.findFirst({ where: (f, { eq }) => eq(f.path, "a.ts") }),
    ).toMatchObject({
      inDegree: 0,
      outDegree: 1,
    });
    expect(
      await db.query.codeFile.findFirst({ where: (f, { eq }) => eq(f.path, "d.ts") }),
    ).toMatchObject({
      inDegree: 1,
      outDegree: 0,
    });
  });
});

describe("blastRadius", () => {
  it("returns transitive downstream (importers) grouped by depth", async () => {
    // page → seed → db ; util → db   (X→Y means X imports Y)
    await ingestCodeGraph({
      files: [{ path: "page.ts" }, { path: "seed.ts" }, { path: "db.ts" }, { path: "util.ts" }],
      edges: [
        { from: "page.ts", to: "seed.ts" },
        { from: "seed.ts", to: "db.ts" },
        { from: "util.ts", to: "db.ts" },
      ],
    });
    const r = await blastRadius(db, "db.ts", { depth: 3 });
    expect(r.exists).toBe(true);
    const down = Object.fromEntries(r.transitive.downstream.map((n) => [n.path, n.depth]));
    expect(down).toEqual({ "seed.ts": 1, "util.ts": 1, "page.ts": 2 });
    // db imports nothing → no upstream.
    expect(r.transitive.upstream).toEqual([]);
    expect(r.hub.inDegree).toBe(2);
  });

  it("returns transitive upstream (dependencies) and respects the depth cap", async () => {
    // a → b → c → d → e
    await ingestCodeGraph({
      files: ["a", "b", "c", "d", "e"].map((p) => ({ path: `${p}.ts` })),
      edges: [
        { from: "a.ts", to: "b.ts" },
        { from: "b.ts", to: "c.ts" },
        { from: "c.ts", to: "d.ts" },
        { from: "d.ts", to: "e.ts" },
      ],
    });
    // From a, upstream (what a depends on) within depth 2 = b (1), c (2). Not d/e.
    const r = await blastRadius(db, "a.ts", { depth: 2 });
    const up = Object.fromEntries(r.transitive.upstream.map((n) => [n.path, n.depth]));
    expect(up).toEqual({ "b.ts": 1, "c.ts": 2 });
    expect(r.transitive.downstream).toEqual([]); // nothing imports a
  });

  it("flags a widely-imported file as a hub and carries lang tags", async () => {
    const importers = Array.from({ length: 6 }, (_, i) => `f${i}.ts`);
    await ingestCodeGraph({
      files: [{ path: "hub.ts", lang: "ts" }, ...importers.map((p) => ({ path: p, lang: "ts" }))],
      edges: importers.map((p) => ({ from: p, to: "hub.ts" })),
    });
    const r = await blastRadius(db, "hub.ts", {});
    expect(r.hub.inDegree).toBe(6);
    expect(r.hub.isHub).toBe(true);
    expect(r.transitive.downstream[0]).toMatchObject({ lang: "ts" });
  });

  it("reports exists:false for an unknown path", async () => {
    const r = await blastRadius(db, "ghost.ts", {});
    expect(r.exists).toBe(false);
    expect(r.transitive.downstream).toEqual([]);
  });
});
