import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// Isolate the roadmap-layout signature file (written by startFeature's auto-layout) to a temp dir
// so tests don't read/write a real workspace's data dir.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-feature-guards-"));

import { db } from "@/lib/db";
import { node, edge } from "@/lib/drizzle/schema";
import { resetDb } from "./helpers";
import { addSubtasksUnder, startFeature } from "@/lib/map-ops";

beforeEach(resetDb);

describe("startFeature creation guard", () => {
  it("rejects creating a brand-new feature without a category", async () => {
    const r = await startFeature({ title: "Some brand new thing zzz" });
    expect(r.action).toBe("rejected");
    if (r.action === "rejected") expect(r.message).toContain("category");
  });

  it("creates (IN_PROGRESS, with the category) when a category is provided", async () => {
    const r = await startFeature({ title: "Some brand new thing zzz", cluster: "DATA" });
    expect(r.action).toBe("created");
    if (r.action === "created") {
      const n = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, r.id) });
      expect(n!.cluster).toBe("DATA");
      expect(n!.status).toBe("IN_PROGRESS");
    }
  });

  it("rejects a front that matches no existing feature (front-as-domain-tag footgun)", async () => {
    const r = await startFeature({ title: "Some task", cluster: "DATA", front: "CRAWL" });
    expect(r.action).toBe("rejected");
    if (r.action === "rejected") expect(r.message).toContain("CRAWL");
  });

  it("nests under a front that DOES match an existing feature", async () => {
    const [parent] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Expand corpus coverage", cluster: "DATA" })
      .returning();
    const r = await startFeature({
      title: "Add a fresh crawler source",
      cluster: "DATA",
      front: "Expand corpus coverage",
    });
    expect(r.action).toBe("created");
    if (r.action === "created") {
      const n = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, r.id) });
      expect(n!.parentId).toBe(parent.id);
    }
  });

  it("flags (not creates, no category needed) when the title matches an existing feature", async () => {
    await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Expand corpus coverage", cluster: "DATA", status: "PENDING" });
    const r = await startFeature({ title: "Expand corpus coverage" });
    expect(r.action).toBe("flagged");
  });
});

describe("startFeature places the new card in its group without moving anything", () => {
  it("existing cards keep their positions; the new card joins its theme's region", async () => {
    const [a] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Foundation", cluster: "DATA", status: "PENDING", x: 1000, y: 0 })
      .returning();
    const [b] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Far away", cluster: "UI", status: "PENDING", x: -2000, y: 900 })
      .returning();
    await db.insert(edge).values({ fromId: b.id, toId: a.id, kind: "DEPENDS" });

    const r = await startFeature({ title: "Another data thing zzz", cluster: "DATA" });
    expect(r.action).toBe("created");

    const aAfter = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, a.id) });
    const bAfter = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, b.id) });
    const created = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.id, (r as { id: string }).id),
    });
    if (!aAfter || !bAfter || !created) throw new Error("not found");
    // The board is never auto-re-laid-out by a create — existing cards stay put.
    expect({ x: aAfter.x, y: aAfter.y }).toEqual({ x: 1000, y: 0 });
    expect({ x: bAfter.x, y: bAfter.y }).toEqual({ x: -2000, y: 900 });
    // The new DATA card lands inside the DATA region (near its sibling), not near UI.
    const d = (p: { x: number; y: number }, q: { x: number; y: number }) =>
      Math.hypot(p.x - q.x, p.y - q.y);
    expect(d(created, aAfter)).toBeLessThan(d(created, bAfter));
  });
});

describe("addSubtasksUnder duplicate guard", () => {
  it("rejects a sub-task that already exists under the parent", async () => {
    const [parent] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Parent feature", cluster: "DATA" })
      .returning();
    await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Wire OAuth", cluster: "DATA", parentId: parent.id });
    const r = await addSubtasksUnder({ parentId: parent.id, items: [{ title: "Wire OAuth" }] });
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "duplicate") expect(r.message).toContain("Wire OAuth");
  });

  it("adds genuinely new sub-tasks", async () => {
    const [parent] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Parent feature", cluster: "DATA" })
      .returning();
    const r = await addSubtasksUnder({ parentId: parent.id, items: [{ title: "A fresh subtask" }] });
    expect(r.ok).toBe(true);
  });
});
