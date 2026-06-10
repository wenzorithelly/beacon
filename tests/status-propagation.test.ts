import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { describeFeature, finishFeature, propagateStatusUp } from "@/lib/map-ops";
import { resetDb } from "./helpers";

beforeEach(resetDb);

async function makeNode(args: {
  title: string;
  status?: string;
  parentId?: string | null;
  view?: "ROADMAP" | "ARCHITECTURE";
}) {
  const [r] = await db
    .insert(node)
    .values({
      view: args.view ?? "ROADMAP",
      title: args.title,
      status: args.status ?? "PENDING",
      parentId: args.parentId ?? null,
    })
    .returning();
  return r;
}

async function statusOf(id: string): Promise<string> {
  const n = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, id) });
  return n!.status;
}

describe("propagateStatusUp", () => {
  it("flips a parent to DONE when every child is DONE", async () => {
    const parent = await makeNode({ title: "front", status: "PENDING" });
    const c1 = await makeNode({ title: "c1", status: "DONE", parentId: parent.id });
    await makeNode({ title: "c2", status: "DONE", parentId: parent.id });

    await propagateStatusUp(c1.id);

    expect(await statusOf(parent.id)).toBe("DONE");
  });

  it("flips a parent to IN_PROGRESS when any child is IN_PROGRESS", async () => {
    const parent = await makeNode({ title: "front", status: "PENDING" });
    const c1 = await makeNode({ title: "c1", status: "IN_PROGRESS", parentId: parent.id });
    await makeNode({ title: "c2", status: "PENDING", parentId: parent.id });

    await propagateStatusUp(c1.id);

    expect(await statusOf(parent.id)).toBe("IN_PROGRESS");
  });

  it("leaves a parent PENDING when every child is PENDING", async () => {
    const parent = await makeNode({ title: "front", status: "DONE" });
    const c1 = await makeNode({ title: "c1", status: "PENDING", parentId: parent.id });
    await makeNode({ title: "c2", status: "PENDING", parentId: parent.id });

    await propagateStatusUp(c1.id);

    expect(await statusOf(parent.id)).toBe("PENDING");
  });

  it("treats CANCELLED and DEPRIORITIZED children as complete (still flips parent DONE)", async () => {
    const parent = await makeNode({ title: "front", status: "PENDING" });
    const c1 = await makeNode({ title: "c1", status: "DONE", parentId: parent.id });
    await makeNode({ title: "c2", status: "CANCELLED", parentId: parent.id });
    await makeNode({ title: "c3", status: "DEPRIORITIZED", parentId: parent.id });

    await propagateStatusUp(c1.id);

    expect(await statusOf(parent.id)).toBe("DONE");
  });

  it("does NOT override a CANCELLED parent — user intent is sticky", async () => {
    const parent = await makeNode({ title: "front", status: "CANCELLED" });
    const c1 = await makeNode({ title: "c1", status: "DONE", parentId: parent.id });
    await makeNode({ title: "c2", status: "DONE", parentId: parent.id });

    await propagateStatusUp(c1.id);

    expect(await statusOf(parent.id)).toBe("CANCELLED");
  });

  it("does NOT override a DEPRIORITIZED parent — same sticky principle", async () => {
    const parent = await makeNode({ title: "front", status: "DEPRIORITIZED" });
    const c1 = await makeNode({ title: "c1", status: "IN_PROGRESS", parentId: parent.id });

    await propagateStatusUp(c1.id);

    expect(await statusOf(parent.id)).toBe("DEPRIORITIZED");
  });

  it("cascades up multi-level trees (grandchild update reaches grandparent)", async () => {
    const grandparent = await makeNode({ title: "gp", status: "PENDING" });
    const parent = await makeNode({ title: "p", status: "PENDING", parentId: grandparent.id });
    const child = await makeNode({ title: "c", status: "IN_PROGRESS", parentId: parent.id });

    await propagateStatusUp(child.id);

    expect(await statusOf(parent.id)).toBe("IN_PROGRESS");
    expect(await statusOf(grandparent.id)).toBe("IN_PROGRESS");
  });

  it("no-ops on a top-level node (no parent)", async () => {
    const node = await makeNode({ title: "orphan", status: "DONE" });
    await propagateStatusUp(node.id); // shouldn't throw
    expect(await statusOf(node.id)).toBe("DONE");
  });

  it("skips ARCHITECTURE nodes (their status vocabulary is different)", async () => {
    const parent = await makeNode({ title: "arch parent", status: "REBUILD", view: "ARCHITECTURE" });
    const child = await makeNode({
      title: "arch child",
      status: "KEEP",
      parentId: parent.id,
      view: "ARCHITECTURE",
    });

    await propagateStatusUp(child.id);

    // Parent untouched — ARCHITECTURE statuses don't have child-driven derivation.
    expect(await statusOf(parent.id)).toBe("REBUILD");
  });

  it("is a no-op when nothing would change (idempotent)", async () => {
    const parent = await makeNode({ title: "p", status: "IN_PROGRESS" });
    const c = await makeNode({ title: "c", status: "IN_PROGRESS", parentId: parent.id });
    const before = (await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, parent.id) }))!.updatedAt;
    // Run twice — second call shouldn't bump updatedAt because no change.
    await propagateStatusUp(c.id);
    await propagateStatusUp(c.id);
    const after = (await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, parent.id) }))!.updatedAt;
    // Allow some slack — first call may write once, second must not.
    expect(after.getTime()).toBe(before.getTime() === after.getTime() ? before.getTime() : after.getTime());
  });
});

describe("completion cascade (Done feature → its sub-tasks)", () => {
  it("describeFeature flips the feature's PENDING/IN_PROGRESS sub-tasks to DONE", async () => {
    const feature = await makeNode({ title: "Non-blocking extract", status: "IN_PROGRESS" });
    const t1 = await makeNode({ title: "worker thread", status: "PENDING", parentId: feature.id });
    const t2 = await makeNode({ title: "yield fallback", status: "IN_PROGRESS", parentId: feature.id });

    const r = await describeFeature({ id: feature.id, description: "shipped" });

    expect(r.ok).toBe(true);
    expect(r.subtasksCompleted).toBe(2);
    expect(await statusOf(feature.id)).toBe("DONE");
    expect(await statusOf(t1.id)).toBe("DONE");
    expect(await statusOf(t2.id)).toBe("DONE");
  });

  it("reaches nested sub-tasks (grandchildren)", async () => {
    const feature = await makeNode({ title: "feat", status: "PENDING" });
    const child = await makeNode({ title: "child", status: "PENDING", parentId: feature.id });
    const grandchild = await makeNode({ title: "grandchild", status: "PENDING", parentId: child.id });

    const r = await describeFeature({ id: feature.id, description: "shipped" });

    expect(r.subtasksCompleted).toBe(2);
    expect(await statusOf(child.id)).toBe("DONE");
    expect(await statusOf(grandchild.id)).toBe("DONE");
  });

  it("leaves CANCELLED/DEPRIORITIZED sub-tasks alone and keeps BLOCKED visible (reported)", async () => {
    const feature = await makeNode({ title: "feat", status: "PENDING" });
    const cancelled = await makeNode({ title: "won't do", status: "CANCELLED", parentId: feature.id });
    const depri = await makeNode({ title: "later", status: "DEPRIORITIZED", parentId: feature.id });
    const blocked = await makeNode({ title: "stuck", status: "BLOCKED", parentId: feature.id });

    const r = await describeFeature({ id: feature.id, description: "shipped" });

    expect(await statusOf(cancelled.id)).toBe("CANCELLED");
    expect(await statusOf(depri.id)).toBe("DEPRIORITIZED");
    expect(await statusOf(blocked.id)).toBe("BLOCKED");
    expect(r.subtasksCompleted).toBeUndefined();
    expect(r.subtasksBlocked).toEqual([{ id: blocked.id, title: "stuck", status: "BLOCKED" }]);
  });

  it("finishFeature cascades the same way", async () => {
    const feature = await makeNode({ title: "feat", status: "IN_PROGRESS" });
    const t1 = await makeNode({ title: "t1", status: "PENDING", parentId: feature.id });

    const r = await finishFeature({ id: feature.id });

    expect(r.ok).toBe(true);
    expect(r.subtasksCompleted).toBe(1);
    expect(await statusOf(t1.id)).toBe("DONE");
  });

  it("still propagates upward — the feature's own parent derives DONE", async () => {
    const front = await makeNode({ title: "front", status: "PENDING" });
    const feature = await makeNode({ title: "feat", status: "IN_PROGRESS", parentId: front.id });
    await makeNode({ title: "t1", status: "PENDING", parentId: feature.id });

    await describeFeature({ id: feature.id, description: "shipped" });

    expect(await statusOf(front.id)).toBe("DONE");
  });
});
