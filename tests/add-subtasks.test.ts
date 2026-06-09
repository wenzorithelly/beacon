import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { createNode } from "@/lib/mutations";
import { addSubtasksUnder } from "@/lib/map-ops";
import { resetDb } from "./helpers";

beforeEach(resetDb);

describe("addSubtasksUnder (bulk sub-task creation under a parent)", () => {
  it("creates each item as a child of the parent referenced by id", async () => {
    const parent = await createNode({
      view: "ROADMAP",
      title: "Tighten loop",
      x: 100,
      y: 50,
    });

    const r = await addSubtasksUnder({
      parentId: parent.id,
      items: [
        { title: "MCP polling cadence", plain: "switch to SSE / shorter poll" },
        { title: "Audit draft endpoint editing" },
      ],
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parent.id).toBe(parent.id);
    expect(r.created.length).toBe(2);

    const children = await db.query.node.findMany({
      where: (t, { eq }) => eq(t.parentId, parent.id),
    });
    expect(children.length).toBe(2);
    const titles = children.map((c) => c.title).sort();
    expect(titles).toEqual(["Audit draft endpoint editing", "MCP polling cadence"]);
    // First item inherits cluster (null here), gets the parent's view, sits below it.
    const a = children.find((c) => c.title === "MCP polling cadence");
    expect(a?.view).toBe("ROADMAP");
    expect(a?.plain).toBe("switch to SSE / shorter poll");
    expect(a?.y).toBe(250); // parent.y(50) + 200
  });

  it("lays children out in a row beneath the parent (no pile-up)", async () => {
    const parent = await createNode({
      view: "ROADMAP",
      title: "Parent",
      x: 400,
      y: 0,
    });
    const r = await addSubtasksUnder({
      parentId: parent.id,
      items: [{ title: "a" }, { title: "b" }, { title: "c" }],
    });
    expect(r.ok).toBe(true);
    const children = await db.query.node.findMany({
      where: (t, { eq }) => eq(t.parentId, parent.id),
      orderBy: (t, { asc }) => asc(t.x),
    });
    expect(children.map((c) => c.x)).toEqual([400, 640, 880]);
    expect(children.every((c) => c.y === 200)).toBe(true);
  });

  it("resolves the parent by fuzzy-title when no id is given", async () => {
    const parent = await createNode({
      view: "ROADMAP",
      title: "Tighten the design-first feedback loop",
    });
    const r = await addSubtasksUnder({
      parentTitle: "tighten design first feedback",
      items: [{ title: "Sub" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parent.id).toBe(parent.id);
  });

  it("inherits the parent's cluster so children land in the same lane", async () => {
    const parent = await createNode({
      view: "ROADMAP",
      title: "Auth",
      cluster: "FRONT_1",
    });
    await addSubtasksUnder({
      parentId: parent.id,
      items: [{ title: "Login flow" }],
    });
    const child = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.parentId, parent.id),
    });
    expect(child?.cluster).toBe("FRONT_1");
  });

  it("rejects empty input cleanly", async () => {
    const parent = await createNode({ view: "ROADMAP", title: "P" });
    const r = await addSubtasksUnder({ parentId: parent.id, items: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("no_items");
  });

  it("returns parent_not_found when the id doesn't exist", async () => {
    const r = await addSubtasksUnder({
      parentId: "nonexistent",
      items: [{ title: "x" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("parent_not_found");
  });

  it("propagates the parent's status (DONE) consistency: child PENDING resets parent to PENDING", async () => {
    // A previously-DONE parent should not stay DONE when a new PENDING child appears.
    // Confirms addSubtasksUnder integrates with propagateStatusUp via createNode.
    const parent = await createNode({ view: "ROADMAP", title: "Done thing" });
    await db.update(node).set({ status: "DONE" }).where(eq(node.id, parent.id));
    await addSubtasksUnder({
      parentId: parent.id,
      items: [{ title: "follow-up" }],
    });
    const fresh = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, parent.id) });
    expect(fresh?.status).toBe("PENDING");
  });
});
