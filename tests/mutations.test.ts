import { beforeEach, describe, expect, it } from "bun:test";
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

describe("status transitions", () => {
  it("sets a valid status and rejects an invalid one", async () => {
    const node = await m.createNode({ view: "ROADMAP", title: "T" });
    expect((await m.setNodeStatus(node.id, "DONE")).status).toBe("DONE");
    await expect(m.setNodeStatus(node.id, "WAT")).rejects.toBeTruthy();
  });

  it("deprioritize parks the node at lowest priority", async () => {
    const node = await m.createNode({ view: "ROADMAP", title: "T", priority: 0 });
    const after = await m.deprioritizeNode(node.id);
    expect(after.status).toBe("DEPRIORITIZED");
    expect(after.priority).toBe(3);
  });

  it("cancel is a soft status change, not a delete", async () => {
    const node = await m.createNode({ view: "ROADMAP", title: "T" });
    const after = await m.cancelNode(node.id);
    expect(after.status).toBe("CANCELLED");
    expect(await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, node.id) })).not.toBeUndefined();
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

