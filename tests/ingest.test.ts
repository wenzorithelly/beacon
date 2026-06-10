import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  endpointTable,
  endpoint,
  dbRelation,
  dbColumn,
  dbTable,
  node,
  syncState,
} from "@/lib/drizzle/schema";
import { getVersion, ingestSnapshot, type Snapshot } from "@/lib/ingest";

async function resetDbDesign() {
  await db.delete(endpointTable);
  await db.delete(endpoint);
  await db.delete(dbRelation);
  await db.delete(dbColumn);
  await db.delete(dbTable);
  await db.delete(syncState);
  await db.delete(node).where(eq(node.view, "ROADMAP"));
}

beforeEach(resetDbDesign);

const SNAP: Snapshot = {
  tables: [
    {
      name: "firms",
      domain: "firms",
      columns: [
        { name: "id", type: "UUID", isPk: true, nullable: false },
        { name: "name", type: "TEXT", nullable: false },
      ],
    },
    {
      name: "users",
      domain: "auth",
      columns: [
        { name: "id", type: "UUID", isPk: true, nullable: false },
        { name: "firm_id", type: "UUID", isFk: true, nullable: false },
      ],
    },
  ],
  relations: [{ fromTable: "users", fromColumn: "firm_id", toTable: "firms", toColumn: "id" }],
  endpoints: [
    {
      method: "POST",
      path: "/auth/register",
      uses: [
        { table: "firms", access: "write" },
        { table: "users", access: "write" },
      ],
    },
  ],
};

describe("ingestSnapshot", () => {
  it("creates introspected tables, columns, relations, endpoints, and usages", async () => {
    const r = await ingestSnapshot(SNAP);
    expect(r).toMatchObject({ tables: 2, relations: 1, endpoints: 1, version: 1 });

    const firms = await db.query.dbTable.findFirst({
      where: (t, { eq }) => eq(t.name, "firms"),
      with: { columns: true, fksIn: true },
    });
    expect(firms!.source).toBe("INTROSPECTION");
    expect(firms!.columns).toHaveLength(2);
    expect(firms!.fksIn).toHaveLength(1);

    const ep = await db.query.endpoint.findFirst({
      where: (t, { eq }) => eq(t.path, "/auth/register"),
      with: { tables: true },
    });
    expect(ep!.source).toBe("INTROSPECTION");
    expect(ep!.tables).toHaveLength(2);
  });

  it("deletes introspected entities that vanish from a later snapshot", async () => {
    await ingestSnapshot(SNAP);
    await ingestSnapshot({ ...SNAP, tables: SNAP.tables!.filter((t) => t.name !== "users") });

    expect(
      await db.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.name, "users") }),
    ).toBeUndefined();
    expect(
      await db.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.name, "firms") }),
    ).not.toBeUndefined();
  });

  it("preserves manually-set positions across re-ingest", async () => {
    await ingestSnapshot(SNAP);
    await db.update(dbTable).set({ x: 999, y: 888 }).where(eq(dbTable.name, "firms"));
    await ingestSnapshot(SNAP);
    const firms = await db.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.name, "firms") });
    expect(firms!.x).toBe(999);
    expect(firms!.y).toBe(888);
  });

  it("never treats an empty section as 'delete everything' — even in full mode", async () => {
    // The standalone watcher posts `tables: []` (no model extraction) and, with no OpenAPI,
    // `endpoints: []`. A full-mode ingest of that used to WIPE every INTROSPECTION row of the
    // target workspace. An empty section means "I saw nothing", never "delete everything".
    await ingestSnapshot(SNAP);
    await ingestSnapshot({ tables: [], relations: [], endpoints: [] });
    const tables = await db.query.dbTable.findMany();
    expect(tables.map((t) => t.name).sort()).toEqual(["firms", "users"]);
    const eps = await db.query.endpoint.findMany();
    expect(eps.length).toBeGreaterThan(0);
  });

  it("keeps planned (MANUAL) entities only while their plan is being implemented", async () => {
    // Active plan → its planned table survives the scan.
    await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Planned work", status: "PENDING", planId: "p-live" });
    await db.insert(dbTable).values({ name: "planned_table", source: "MANUAL", planId: "p-live" });
    // No lineage → a leftover from before plan lineage existed; the scan prunes it.
    await db.insert(dbTable).values({ name: "manual_table", source: "MANUAL" });
    await ingestSnapshot(SNAP);
    expect(
      await db.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.name, "planned_table") }),
    ).toBeTruthy();
    expect(
      await db.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.name, "manual_table") }),
    ).toBeFalsy();
  });

  it("can link a usage to a planned table of an active plan by name", async () => {
    await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Audit plan", status: "IN_PROGRESS", planId: "p-audit" });
    await db.insert(dbTable).values({ name: "legacy_audit", source: "MANUAL", planId: "p-audit" });
    await ingestSnapshot({
      tables: [{ name: "events", columns: [{ name: "id", type: "UUID", isPk: true }] }],
      endpoints: [
        { method: "GET", path: "/events", uses: [{ table: "legacy_audit", access: "read" }] },
      ],
    });
    const ep = await db.query.endpoint.findFirst({
      where: (t, { eq }) => eq(t.path, "/events"),
      with: { tables: { with: { table: true } } },
    });
    expect(ep!.tables.map((t) => t.table.name)).toContain("legacy_audit");
  });

  it("bumps the sync version on each ingest", async () => {
    expect(await getVersion()).toBe(0);
    await ingestSnapshot(SNAP);
    await ingestSnapshot(SNAP);
    expect(await getVersion()).toBe(2);
  });

  it("self-heals an overlapping /db layout — no manual relayout button required", async () => {
    // Seed three INTROSPECTION tables stacked on top of each other at the origin —
    // exactly the broken state a pre-fix beacon db ended up in.
    await db.insert(dbTable).values([
      { name: "firms", source: "INTROSPECTION", x: 0, y: 0 },
      { name: "users", source: "INTROSPECTION", x: 0, y: 0 },
      { name: "audits", source: "INTROSPECTION", x: 0, y: 0 },
    ]);
    await db.insert(endpoint).values([
      { method: "GET", path: "/a", source: "INTROSPECTION", x: -460, y: 100 },
      { method: "GET", path: "/b", source: "INTROSPECTION", x: -460, y: 100 },
    ]);

    await ingestSnapshot({
      tables: [
        { name: "firms", columns: [{ name: "id", type: "UUID", isPk: true }] },
        { name: "users", columns: [{ name: "id", type: "UUID", isPk: true }] },
        { name: "audits", columns: [{ name: "id", type: "UUID", isPk: true }] },
      ],
      endpoints: [
        { method: "GET", path: "/a", uses: [] },
        { method: "GET", path: "/b", uses: [] },
      ],
    });

    const tables = await db.query.dbTable.findMany();
    const tableKeys = new Set(tables.map((t) => `${t.x}:${t.y}`));
    expect(tableKeys.size).toBe(tables.length); // every table at a distinct slot
    const eps = await db.query.endpoint.findMany();
    const epKeys = new Set(eps.map((e) => `${e.x}:${e.y}`));
    expect(epKeys.size).toBe(eps.length);
  });
});

// Partial mode: the inline watcher's deterministic extract may know only ONE side (e.g. a
// Python repo has tables but no Next routes). An empty section then means "unknown", never
// "delete everything introspected".
describe("ingestSnapshot — partial mode", () => {
  it("an empty endpoints section leaves introspected endpoints untouched", async () => {
    await ingestSnapshot(
      { tables: [], relations: [], endpoints: [{ method: "GET", path: "/api/a", uses: [] }] },
      db,
    );
    await ingestSnapshot(
      { tables: [{ name: "T", columns: [{ name: "id", type: "text" }] }], relations: [], endpoints: [] },
      db,
      { partial: true },
    );
    const eps = await db.query.endpoint.findMany();
    expect(eps.map((e) => e.path)).toContain("/api/a");
    expect((await db.query.dbTable.findMany()).map((t) => t.name)).toContain("T");
  });

  it("an empty tables section leaves introspected tables untouched", async () => {
    await ingestSnapshot(
      { tables: [{ name: "Keep", columns: [{ name: "id", type: "text" }] }], relations: [], endpoints: [] },
      db,
    );
    await ingestSnapshot(
      { tables: [], relations: [], endpoints: [{ method: "GET", path: "/api/b", uses: [] }] },
      db,
      { partial: true },
    );
    expect((await db.query.dbTable.findMany()).map((t) => t.name)).toContain("Keep");
  });

  it("partial re-ingest of an endpoint without uses keeps its existing table links", async () => {
    await ingestSnapshot(
      {
        tables: [{ name: "T2", columns: [{ name: "id", type: "text" }] }],
        relations: [],
        endpoints: [{ method: "GET", path: "/api/c", uses: [{ table: "T2", access: "read" }] }],
      },
      db,
    );
    await ingestSnapshot(
      { tables: [], relations: [], endpoints: [{ method: "GET", path: "/api/c", uses: [] }] },
      db,
      { partial: true },
    );
    const ep = (await db.query.endpoint.findMany({ with: { tables: true } })).find(
      (e) => e.path === "/api/c",
    )!;
    expect(ep.tables.length).toBe(1);
  });
});
