import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { getVersion, ingestSnapshot, type Snapshot } from "@/lib/ingest";

async function resetDbDesign() {
  await db.endpointTable.deleteMany();
  await db.endpoint.deleteMany();
  await db.dbRelation.deleteMany();
  await db.dbColumn.deleteMany();
  await db.dbTable.deleteMany();
  await db.syncState.deleteMany();
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

    const firms = await db.dbTable.findUnique({
      where: { name: "firms" },
      include: { columns: true, fksIn: true },
    });
    expect(firms!.source).toBe("INTROSPECTION");
    expect(firms!.columns).toHaveLength(2);
    expect(firms!.fksIn).toHaveLength(1);

    const ep = await db.endpoint.findFirst({ where: { path: "/auth/register" }, include: { tables: true } });
    expect(ep!.source).toBe("INTROSPECTION");
    expect(ep!.tables).toHaveLength(2);
  });

  it("deletes introspected entities that vanish from a later snapshot", async () => {
    await ingestSnapshot(SNAP);
    await ingestSnapshot({ ...SNAP, tables: SNAP.tables!.filter((t) => t.name !== "users") });

    expect(await db.dbTable.findUnique({ where: { name: "users" } })).toBeNull();
    expect(await db.dbTable.findUnique({ where: { name: "firms" } })).not.toBeNull();
  });

  it("preserves manually-set positions across re-ingest", async () => {
    await ingestSnapshot(SNAP);
    await db.dbTable.update({ where: { name: "firms" }, data: { x: 999, y: 888 } });
    await ingestSnapshot(SNAP);
    const firms = await db.dbTable.findUnique({ where: { name: "firms" } });
    expect(firms!.x).toBe(999);
    expect(firms!.y).toBe(888);
  });

  it("never touches manual (hand-authored) entities", async () => {
    await db.dbTable.create({ data: { name: "manual_table", source: "MANUAL" } });
    await ingestSnapshot(SNAP);
    const manual = await db.dbTable.findUnique({ where: { name: "manual_table" } });
    expect(manual).not.toBeNull();
    expect(manual!.source).toBe("MANUAL");
  });

  it("can link a usage to a manual table by name", async () => {
    await db.dbTable.create({ data: { name: "legacy_audit", source: "MANUAL" } });
    await ingestSnapshot({
      tables: [{ name: "events", columns: [{ name: "id", type: "UUID", isPk: true }] }],
      endpoints: [
        { method: "GET", path: "/events", uses: [{ table: "legacy_audit", access: "read" }] },
      ],
    });
    const ep = await db.endpoint.findFirst({ where: { path: "/events" }, include: { tables: { include: { table: true } } } });
    expect(ep!.tables.map((t) => t.table.name)).toContain("legacy_audit");
  });

  it("bumps the sync version on each ingest", async () => {
    expect(await getVersion()).toBe(0);
    await ingestSnapshot(SNAP);
    await ingestSnapshot(SNAP);
    expect(await getVersion()).toBe(2);
  });
});
