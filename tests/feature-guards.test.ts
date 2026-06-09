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

describe("startFeature re-lays-out the board organically", () => {
  it("clusters dependency-linked features closer than an unrelated new one", async () => {
    const [a] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Foundation", cluster: "DATA", status: "PENDING", x: 1000, y: 0 })
      .returning();
    const [b] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Built on top", cluster: "DATA", status: "PENDING", x: 0, y: 0 })
      .returning();
    await db.insert(edge).values({ fromId: b.id, toId: a.id, kind: "DEPENDS" }); // b depends on a

    // Creating a feature changes the structure → the board is re-laid-out by the force layout.
    const r = await startFeature({ title: "Unrelated new thing zzz", cluster: "DATA" });
    expect(r.action).toBe("created");

    const aAfter = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, a.id) });
    if (!aAfter) throw new Error("not found");
    const bAfter = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, b.id) });
    if (!bAfter) throw new Error("not found");
    const newAfter = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.id, (r as { id: string }).id),
    });
    if (!newAfter) throw new Error("not found");
    const d = (p: { x: number; y: number }, q: { x: number; y: number }) =>
      Math.hypot(p.x - q.x, p.y - q.y);
    // The two linked features end up nearer each other than the unrelated new feature.
    expect(d(aAfter, bAfter)).toBeLessThan(d(aAfter, newAfter));
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
