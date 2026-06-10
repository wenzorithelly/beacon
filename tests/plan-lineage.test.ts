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
