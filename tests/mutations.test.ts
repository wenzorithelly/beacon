import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import * as m from "@/lib/mutations";
import { resetDb } from "./helpers";

beforeEach(resetDb);

describe("createNode", () => {
  it("creates a roadmap node with sensible defaults", async () => {
    const node = await m.createNode({ view: "ROADMAP", title: "New front" });
    expect(node.status).toBe("PENDING");
    expect(node.priority).toBe(2);
    expect(node.x).toBe(0);
    expect(node.y).toBe(0);
    expect(node.parentId).toBeNull();
  });

  it("defaults architecture nodes to REBUILD", async () => {
    const node = await m.createNode({ view: "ARCHITECTURE", title: "Some service" });
    expect(node.status).toBe("REBUILD");
  });

  it("creates a subnode linked to its parent", async () => {
    const parent = await m.createNode({ view: "ROADMAP", title: "Front", cluster: "FRONT_2" });
    const child = await m.createNode({
      view: "ROADMAP",
      title: "Subtask",
      cluster: "FRONT_2",
      parentId: parent.id,
    });
    expect(child.parentId).toBe(parent.id);
  });

  it("uses a client-supplied id when provided (optimistic create)", async () => {
    const node = await m.createNode({ view: "ROADMAP", title: "Optimistic", id: "abc123client" });
    expect(node.id).toBe("abc123client");
  });

  it("still auto-generates an id when none is supplied", async () => {
    const node = await m.createNode({ view: "ROADMAP", title: "Auto" });
    expect(node.id).toBeTruthy();
    expect(node.id.length).toBeGreaterThan(8);
  });

  it("rejects an invalid view", async () => {
    await expect(
      // @ts-expect-error — deliberately invalid
      m.createNode({ view: "NONSENSE", title: "x" }),
    ).rejects.toBeTruthy();
  });

  it("rejects an empty title", async () => {
    await expect(m.createNode({ view: "ROADMAP", title: "  " })).rejects.toBeTruthy();
  });
});

describe("updateNode", () => {
  it("updates editable fields", async () => {
    const node = await m.createNode({ view: "ROADMAP", title: "Old" });
    const updated = await m.updateNode(node.id, { title: "New", plain: "explanation" });
    expect(updated.title).toBe("New");
    expect(updated.plain).toBe("explanation");
  });
});

describe("accepting a suggestion (source INIT → MANUAL)", () => {
  it("persists the promotion so a re-init won't wipe the card", async () => {
    const created = await m.createNode({ view: "ROADMAP", title: "Suggested" });
    await db.update(node).set({ source: "INIT" }).where(eq(node.id, created.id));
    const updated = await m.updateNode(created.id, { source: "MANUAL" });
    expect(updated.source).toBe("MANUAL");
  });

  it("rejects any client-set source other than MANUAL", async () => {
    const created = await m.createNode({ view: "ROADMAP", title: "T" });
    await expect(
      // @ts-expect-error — deliberately invalid: INIT/DRAFT/LINEAR lineage is server-assigned
      m.updateNode(created.id, { source: "INIT" }),
    ).rejects.toBeTruthy();
  });
});

// The Details panel (and the edit dialog) persist through the tab-pinned
// PATCH /api/nodes/{id} route, whose body is updateNodeSchema → updateNode. These lock
// the transitions that used to ride dedicated server actions onto that single path.
describe("PATCH-path parity (canvas mutations via updateNode)", () => {
  it("soft-cancels via a plain field update (CANCELLED keeps the row)", async () => {
    const created = await m.createNode({ view: "ROADMAP", title: "T" });
    const after = await m.updateNode(created.id, { status: "CANCELLED" });
    expect(after.status).toBe("CANCELLED");
    expect(
      await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, created.id) }),
    ).not.toBeUndefined();
  });

  it("deprioritizes in one update (status + priority together)", async () => {
    const created = await m.createNode({ view: "ROADMAP", title: "T", priority: 0 });
    const after = await m.updateNode(created.id, { status: "DEPRIORITIZED", priority: 3 });
    expect(after.status).toBe("DEPRIORITIZED");
    expect(after.priority).toBe(3);
  });

  it("propagates a status change up to the parent", async () => {
    const parent = await m.createNode({ view: "ROADMAP", title: "P" });
    const child = await m.createNode({ view: "ROADMAP", title: "C", parentId: parent.id });
    await m.updateNode(child.id, { status: "IN_PROGRESS" });
    let p = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, parent.id) });
    expect(p?.status).toBe("IN_PROGRESS");
    await m.updateNode(child.id, { status: "DONE" });
    p = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, parent.id) });
    expect(p?.status).toBe("DONE");
  });

  it("updates kind (edit-dialog FEATURE→BUG) and priority in range", async () => {
    const created = await m.createNode({ view: "ROADMAP", title: "T" });
    const after = await m.updateNode(created.id, { kind: "BUG", priority: 1 });
    expect(after.kind).toBe("BUG");
    expect(after.priority).toBe(1);
  });

  it("rejects an out-of-range priority", async () => {
    const created = await m.createNode({ view: "ROADMAP", title: "T" });
    await expect(m.updateNode(created.id, { priority: 5 })).rejects.toBeTruthy();
  });

  it("rejects an invalid status", async () => {
    const created = await m.createNode({ view: "ROADMAP", title: "T" });
    await expect(
      // @ts-expect-error — deliberately invalid
      m.updateNode(created.id, { status: "WAT" }),
    ).rejects.toBeTruthy();
  });
});

describe("deleteNode", () => {
  it("removes the node and cascades children", async () => {
    const parent = await m.createNode({ view: "ROADMAP", title: "P" });
    const child = await m.createNode({ view: "ROADMAP", title: "C", parentId: parent.id });
    await m.deleteNode(parent.id);
    expect(await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, child.id) })).toBeUndefined();
  });
});

describe("updateNodePosition", () => {
  it("persists x/y", async () => {
    const node = await m.createNode({ view: "ROADMAP", title: "T" });
    const moved = await m.updateNodePosition(node.id, 123.5, -40);
    expect(moved.x).toBe(123.5);
    expect(moved.y).toBe(-40);
  });
});

