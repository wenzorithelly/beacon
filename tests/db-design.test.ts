import { beforeAll, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { seedDatabaseDesign } from "@/lib/seed-db";

beforeAll(async () => {
  await seedDatabaseDesign();
});

describe("db design seed", () => {
  it("seeds tables, each with a primary key", async () => {
    const tables = await db.dbTable.findMany({ include: { columns: true } });
    expect(tables.length).toBeGreaterThanOrEqual(10);
    for (const t of tables) {
      expect(t.columns.length, t.name).toBeGreaterThan(0);
      expect(t.columns.some((c) => c.isPk), t.name).toBe(true);
    }
  });

  it("makes firms the multi-tenant hub (most tables FK to it)", async () => {
    const firms = await db.dbTable.findUnique({
      where: { name: "firms" },
      include: { fksIn: true },
    });
    expect(firms).not.toBeNull();
    // users, api_keys, firm_invites, searches, uploads, petitions, monitored_processes, audit_log
    expect(firms!.fksIn.length).toBeGreaterThanOrEqual(7);
  });

  it("every FK relation points at a real table column", async () => {
    const rels = await db.dbRelation.findMany({
      include: { fromTable: { include: { columns: true } }, toTable: { include: { columns: true } } },
    });
    expect(rels.length).toBeGreaterThanOrEqual(10);
    for (const r of rels) {
      expect(r.fromTable.columns.some((c) => c.name === r.fromColumn), r.label ?? "").toBe(true);
      expect(r.toTable.columns.some((c) => c.name === r.toColumn), r.label ?? "").toBe(true);
    }
  });

  it("records which endpoints use which tables", async () => {
    const endpoints = await db.endpoint.findMany({ include: { tables: true } });
    expect(endpoints.length).toBeGreaterThanOrEqual(10);
    for (const e of endpoints) {
      expect(e.tables.length, `${e.method} ${e.path}`).toBeGreaterThan(0);
    }
    // the search endpoint must touch precedents + apply quota on firms
    const search = await db.endpoint.findFirst({
      where: { path: "/search" },
      include: { tables: { include: { table: true } } },
    });
    const used = search!.tables.map((t) => t.table.name);
    expect(used).toContain("precedents");
    expect(used).toContain("firms");
  });

  it("is idempotent", async () => {
    const before = await db.dbTable.count();
    await seedDatabaseDesign();
    expect(await db.dbTable.count()).toBe(before);
  });
});
