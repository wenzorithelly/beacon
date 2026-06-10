import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// Isolate the per-workspace data dir so each test starts clean.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-plan-lineage-"));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { dbTable, endpoint, node } from "@/lib/drizzle/schema";
import { approvePlan } from "@/lib/plan-resolve";
import { listHistory } from "@/lib/plan-history";
import { prunePlannedEntities } from "@/lib/plan-lineage";
import { ingestSnapshot } from "@/lib/ingest";
import { describeFeature } from "@/lib/map-ops";

// Lineage: every entity an approved plan creates carries the plan's id, so the board can
// tell "planned as part of an active plan" from "leftover of a shipped one" — and prune
// the latter (see prunePlannedEntities).

const doc = (proposedAt: number) => ({
  proposedAt,
  status: "pending",
  tables: [
    {
      id: "t1",
      name: "monitored_things",
      domain: "DATA",
      description: null,
      x: 0,
      y: 0,
      columns: [{ name: "id", type: "uuid", isPk: true, isFk: false, nullable: false, note: null }],
    },
  ],
  relations: [],
  endpoints: [
    {
      id: "e1",
      method: "POST",
      path: "/api/v1/things",
      domain: "DATA",
      description: null,
      x: 0,
      y: 0,
      links: [{ tableId: "t1", access: "write" }],
    },
  ],
});

describe("plan lineage stamping", () => {
  beforeEach(async () => {
    await db.delete(node).where(eq(node.view, "ROADMAP"));
    await db.delete(endpoint);
    await db.delete(dbTable);
  });

  it("stamps approved tables, endpoints and promoted features with the archived plan id", async () => {
    await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Monitor things", cluster: "DATA", source: "DRAFT" });
    await approvePlan({ doc: doc(1) });

    const t = await db.query.dbTable.findFirst({ where: (x, { eq }) => eq(x.name, "monitored_things") });
    const e = await db.query.endpoint.findFirst({ where: (x, { eq }) => eq(x.path, "/api/v1/things") });
    const f = await db.query.node.findFirst({ where: (x, { eq }) => eq(x.title, "Monitor things") });
    expect(t?.planId).toBeTruthy();
    expect(e?.planId).toBe(t!.planId);
    expect(f?.planId).toBe(t!.planId);
    expect(f?.source).toBe("MANUAL");
    // Archive id IS the lineage id — one string to correlate board ↔ history.
    expect(listHistory()[0]?.id).toBe(t!.planId!);
  });

  it("re-approving over an existing table re-stamps it with the newest plan", async () => {
    await approvePlan({ doc: doc(1) });
    const first = (await db.query.dbTable.findFirst({
      where: (x, { eq }) => eq(x.name, "monitored_things"),
    }))!.planId;
    await approvePlan({ doc: doc(2) });
    const second = (await db.query.dbTable.findFirst({
      where: (x, { eq }) => eq(x.name, "monitored_things"),
    }))!.planId;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });
});

// Wenzo's invariant: the /db board shows ONLY tables truly in the code, plus the planned
// tables of plans currently being implemented. Everything else is pruned.
describe("prunePlannedEntities", () => {
  beforeEach(async () => {
    await db.delete(node).where(eq(node.view, "ROADMAP"));
    await db.delete(endpoint);
    await db.delete(dbTable);
  });

  const table = (name: string, source: string, planId: string | null) =>
    db.insert(dbTable).values({ name, source, planId });
  const ep = (path: string, source: string, planId: string | null) =>
    db.insert(endpoint).values({ method: "GET", path, source, planId });
  const feature = (planId: string, status: string) =>
    db.insert(node).values({ view: "ROADMAP", title: `f-${planId}-${status}`, status, planId });

  it("keeps planned rows while ANY of their plan's features is unsettled", async () => {
    await feature("p1", "DONE");
    await feature("p1", "PENDING");
    await table("planned_active", "MANUAL", "p1");
    await ep("/planned-active", "MANUAL", "p1");
    await prunePlannedEntities();
    expect(await db.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.name, "planned_active") })).toBeTruthy();
    expect(await db.query.endpoint.findFirst({ where: (t, { eq }) => eq(t.path, "/planned-active") })).toBeTruthy();
  });

  it("prunes planned rows once every feature of their plan settled", async () => {
    await feature("p1", "DONE");
    await feature("p1", "CANCELLED");
    await table("planned_shipped", "MANUAL", "p1");
    await ep("/planned-shipped", "MANUAL", "p1");
    const out = await prunePlannedEntities();
    expect(out).toEqual({ tables: 1, endpoints: 1 });
    expect(await db.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.name, "planned_shipped") })).toBeFalsy();
    expect(await db.query.endpoint.findFirst({ where: (t, { eq }) => eq(t.path, "/planned-shipped") })).toBeFalsy();
  });

  it("prunes planned rows with no lineage at all (legacy phantoms)", async () => {
    await table("legacy_phantom", "MANUAL", null);
    await ep("/legacy-phantom", "MANUAL", null);
    await prunePlannedEntities();
    expect(await db.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.name, "legacy_phantom") })).toBeFalsy();
    expect(await db.query.endpoint.findFirst({ where: (t, { eq }) => eq(t.path, "/legacy-phantom") })).toBeFalsy();
  });

  it("never touches code-derived (INTROSPECTION) rows", async () => {
    await feature("p1", "DONE");
    await table("real_no_lineage", "INTROSPECTION", null);
    await table("real_flipped", "INTROSPECTION", "p1");
    await prunePlannedEntities();
    expect(await db.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.name, "real_no_lineage") })).toBeTruthy();
    expect(await db.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.name, "real_flipped") })).toBeTruthy();
  });

  it("treats a plan with zero roadmap nodes as active (DB-only plans are not auto-pruned)", async () => {
    await table("db_only_plan_table", "MANUAL", "p-db-only");
    await prunePlannedEntities();
    expect(
      await db.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.name, "db_only_plan_table") }),
    ).toBeTruthy();
  });

  it("runs at the tail of every code ingest", async () => {
    await table("stale_from_old_plan", "MANUAL", null);
    await ingestSnapshot({
      tables: [{ name: "real_table", columns: [{ name: "id", type: "UUID", isPk: true }] }],
      endpoints: [],
    });
    expect(
      await db.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.name, "stale_from_old_plan") }),
    ).toBeFalsy();
    expect(
      await db.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.name, "real_table") }),
    ).toBeTruthy();
  });

  it("runs when a feature registers Done, so the board cleans up immediately", async () => {
    const [f] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Ship the thing", status: "IN_PROGRESS", planId: "p9" })
      .returning({ id: node.id });
    await table("planned_p9", "MANUAL", "p9");
    await describeFeature({ id: f.id, description: "Shipped." });
    expect(await db.query.dbTable.findFirst({ where: (t, { eq }) => eq(t.name, "planned_p9") })).toBeFalsy();
  });
});
