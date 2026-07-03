import { beforeEach, describe, expect, it } from "bun:test";
import { count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { codeFileEdge, codeFile, syncState } from "@/lib/drizzle/schema";
import {
  type CodeGraphInput,
  findCircularEdges,
  ingestCodeGraph,
} from "@/lib/code-graph";

async function resetCodeGraph() {
  await db.delete(codeFileEdge);
  await db.delete(codeFile);
  await db.delete(syncState);
}

beforeEach(resetCodeGraph);

const SNAP: CodeGraphInput = {
  files: [
    { path: "app/page.tsx" },
    { path: "lib/db.ts" },
    { path: "lib/utils.ts" },
  ],
  edges: [
    { from: "app/page.tsx", to: "lib/db.ts" },
    { from: "app/page.tsx", to: "lib/utils.ts" },
    { from: "lib/db.ts", to: "lib/utils.ts" },
  ],
};

describe("ingestCodeGraph", () => {
  it("creates files + edges and bumps version", async () => {
    const r = await ingestCodeGraph(SNAP);
    expect(r).toMatchObject({ files: 3, edges: 3, version: 1 });

    const files = await db.query.codeFile.findMany({ orderBy: (f, { asc }) => asc(f.path) });
    expect(files.map((f) => f.path)).toEqual([
      "app/page.tsx",
      "lib/db.ts",
      "lib/utils.ts",
    ]);

    const edges = await db.query.codeFileEdge.findMany({
      orderBy: (e, { asc }) => [asc(e.fromPath), asc(e.toPath)],
    });
    expect(edges.map((e) => `${e.fromPath}→${e.toPath}`)).toEqual([
      "app/page.tsx→lib/db.ts",
      "app/page.tsx→lib/utils.ts",
      "lib/db.ts→lib/utils.ts",
    ]);
  });

  it("is idempotent — re-ingesting the same snapshot doesn't duplicate", async () => {
    await ingestCodeGraph(SNAP);
    await ingestCodeGraph(SNAP);
    expect((await db.select({ n: count() }).from(codeFile))[0].n).toBe(3);
    expect((await db.select({ n: count() }).from(codeFileEdge))[0].n).toBe(3);
  });

  it("deletes files that vanished from a later snapshot (cascades edges)", async () => {
    await ingestCodeGraph(SNAP);
    await ingestCodeGraph({
      ...SNAP,
      files: SNAP.files!.filter((f) => f.path !== "lib/utils.ts"),
      edges: SNAP.edges!.filter(
        (e) => e.from !== "lib/utils.ts" && e.to !== "lib/utils.ts",
      ),
    });
    expect(
      await db.query.codeFile.findFirst({ where: (f, { eq }) => eq(f.path, "lib/utils.ts") }),
    ).toBeUndefined();
    expect((await db.select({ n: count() }).from(codeFileEdge))[0].n).toBe(1); // page → db only
  });

  it("preserves manually-set positions across re-ingest", async () => {
    await ingestCodeGraph(SNAP);
    await db.update(codeFile).set({ x: 999, y: 888 }).where(eq(codeFile.path, "lib/db.ts"));
    await ingestCodeGraph(SNAP);
    const f = await db.query.codeFile.findFirst({ where: (cf, { eq }) => eq(cf.path, "lib/db.ts") });
    expect(f!.x).toBe(999);
    expect(f!.y).toBe(888);
  });

  it("silently drops edges whose endpoints aren't in the files list", async () => {
    const r = await ingestCodeGraph({
      files: [{ path: "a.ts" }, { path: "b.ts" }],
      edges: [
        { from: "a.ts", to: "b.ts" },
        { from: "a.ts", to: "ghost.ts" }, // dangling target
        { from: "ghost.ts", to: "b.ts" }, // dangling source
      ],
    });
    expect(r.edges).toBe(1);
    expect((await db.select({ n: count() }).from(codeFileEdge))[0].n).toBe(1);
  });

  it("drops self-edges", async () => {
    await ingestCodeGraph({
      files: [{ path: "a.ts" }],
      edges: [{ from: "a.ts", to: "a.ts" }],
    });
    expect((await db.select({ n: count() }).from(codeFileEdge))[0].n).toBe(0);
  });

  it("persists root + lang tags on files", async () => {
    await ingestCodeGraph({
      files: [
        { path: "apps/web/page.tsx", root: "apps/web", lang: "ts" },
        { path: "services/api/main.py", root: "services/api", lang: "py" },
      ],
      edges: [],
    });
    const web = await db.query.codeFile.findFirst({
      where: (f, { eq }) => eq(f.path, "apps/web/page.tsx"),
    });
    expect(web).toMatchObject({ root: "apps/web", lang: "ts" });
    const api = await db.query.codeFile.findFirst({
      where: (f, { eq }) => eq(f.path, "services/api/main.py"),
    });
    expect(api).toMatchObject({ root: "services/api", lang: "py" });
  });

  it("stamps SyncState.codeGraphSyncedAt on every sync (staleness signal)", async () => {
    await ingestCodeGraph({ files: [{ path: "a.ts" }], edges: [] });
    const s = await db.query.syncState.findFirst({ where: (t, { eq }) => eq(t.id, "singleton") });
    expect(s?.codeGraphSyncedAt).toBeInstanceOf(Date);
  });

  it("persists mtimeMs + size on files", async () => {
    await ingestCodeGraph({ files: [{ path: "a.ts", mtimeMs: 123456, size: 42 }], edges: [] });
    const a = await db.query.codeFile.findFirst({ where: (f, { eq }) => eq(f.path, "a.ts") });
    expect(a).toMatchObject({ mtimeMs: 123456, size: 42 });
  });

  it("flags edges inside an import cycle as circular", async () => {
    // a → b → c → a is a 3-cycle; every edge is circular.
    // a → d is acyclic.
    const r = await ingestCodeGraph({
      files: [{ path: "a.ts" }, { path: "b.ts" }, { path: "c.ts" }, { path: "d.ts" }],
      edges: [
        { from: "a.ts", to: "b.ts" },
        { from: "b.ts", to: "c.ts" },
        { from: "c.ts", to: "a.ts" },
        { from: "a.ts", to: "d.ts" },
      ],
    });
    expect(r.circular).toBe(3);

    const circular = await db.query.codeFileEdge.findMany({
      where: (e, { eq }) => eq(e.circular, true),
      orderBy: (e, { asc }) => [asc(e.fromPath), asc(e.toPath)],
    });
    expect(circular.map((e) => `${e.fromPath}→${e.toPath}`)).toEqual([
      "a.ts→b.ts",
      "b.ts→c.ts",
      "c.ts→a.ts",
    ]);
    const acyclic = await db.query.codeFileEdge.findMany({
      where: (e, { eq }) => eq(e.circular, false),
    });
    expect(acyclic.map((e) => `${e.fromPath}→${e.toPath}`)).toEqual(["a.ts→d.ts"]);
  });
});

describe("findCircularEdges", () => {
  const key = (from: string, to: string) => `${from}|${to}`;

  it("returns empty set for a DAG", () => {
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "a", to: "c" },
    ];
    expect(findCircularEdges(["a", "b", "c"], edges).size).toBe(0);
  });

  it("flags every edge in a 2-cycle", () => {
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ];
    const c = findCircularEdges(["a", "b"], edges);
    expect(c.has(key("a", "b"))).toBe(true);
    expect(c.has(key("b", "a"))).toBe(true);
  });

  it("only flags edges INSIDE the SCC, not edges leaving it", () => {
    // a → b → a forms the cycle; a → c leaves it.
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
      { from: "a", to: "c" },
    ];
    const c = findCircularEdges(["a", "b", "c"], edges);
    expect(c.has(key("a", "b"))).toBe(true);
    expect(c.has(key("b", "a"))).toBe(true);
    expect(c.has(key("a", "c"))).toBe(false);
  });

  it("handles two independent cycles correctly", () => {
    const edges = [
      // cycle 1: a ↔ b
      { from: "a", to: "b" },
      { from: "b", to: "a" },
      // cycle 2: c → d → e → c
      { from: "c", to: "d" },
      { from: "d", to: "e" },
      { from: "e", to: "c" },
      // bridge: a → c (acyclic; doesn't merge the SCCs)
      { from: "a", to: "c" },
    ];
    const c = findCircularEdges(["a", "b", "c", "d", "e"], edges);
    expect(c.size).toBe(5);
    expect(c.has(key("a", "c"))).toBe(false);
  });

  it("survives a deep chain without stack overflow (iterative Tarjan's)", () => {
    // 10k-long DAG: 0 → 1 → 2 → ... → 9999. No cycles.
    const N = 10_000;
    const nodes = Array.from({ length: N }, (_, i) => String(i));
    const edges = Array.from({ length: N - 1 }, (_, i) => ({
      from: String(i),
      to: String(i + 1),
    }));
    expect(findCircularEdges(nodes, edges).size).toBe(0);
  });
});

describe("ingestCodeGraph — large repos (SQLite variable limit)", () => {
  // A home-dir / monorepo workspace can hold tens of thousands of files. The stale-file
  // delete used `NOT IN (?,...one per path)` and the edge insert bound 3 vars per row —
  // both blow SQLite's variable cap and error on EVERY watcher tick. Must be chunked.
  it("ingests and prunes a graph with thousands of files without erroring", async () => {
    const files = Array.from({ length: 1500 }, (_, i) => ({ path: `src/m${i}.ts` }));
    const edges = Array.from({ length: 1400 }, (_, i) => ({
      from: `src/m${i}.ts`,
      to: `src/m${i + 1}.ts`,
    }));
    const r1 = await ingestCodeGraph({ files, edges });
    expect(r1.files).toBe(1500);
    expect(r1.edges).toBe(1400);

    // Re-ingest with 400 files gone — the stale delete must also survive the cap.
    const r2 = await ingestCodeGraph({ files: files.slice(0, 1100), edges: edges.slice(0, 1000) });
    expect(r2.files).toBe(1100);
    const [{ value: left }] = await db.select({ value: count() }).from(codeFile);
    expect(left).toBe(1100);
    // 1500-file ingest + re-ingest is genuinely heavy; the 5s default flakes on slower CI runners.
  }, 30_000);
});
