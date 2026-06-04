import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "./helpers";

beforeEach(resetDb);

describe("Node tree", () => {
  it("creates a node with children and reads them back", async () => {
    const parent = await db.node.create({
      data: {
        view: "ROADMAP",
        cluster: "FRONT_2",
        title: "Introduce escritório/org",
        children: {
          create: [
            { view: "ROADMAP", cluster: "FRONT_2", title: "Member invites" },
            { view: "ROADMAP", cluster: "FRONT_2", title: "Encrypt API keys" },
          ],
        },
      },
      include: { children: true },
    });

    expect(parent.children).toHaveLength(2);
    expect(parent.children.map((c) => c.parentId)).toEqual([parent.id, parent.id]);
  });

  it("cascade-deletes the subtree when a parent is removed", async () => {
    const parent = await db.node.create({
      data: {
        view: "ROADMAP",
        title: "Front",
        children: { create: [{ view: "ROADMAP", title: "Task" }] },
      },
      include: { children: true },
    });
    const childId = parent.children[0].id;

    await db.node.delete({ where: { id: parent.id } });

    expect(await db.node.findUnique({ where: { id: childId } })).toBeNull();
    expect(await db.node.count()).toBe(0);
  });
});

describe("Edge", () => {
  it("enforces the (from,to,kind) unique constraint", async () => {
    const a = await db.node.create({ data: { view: "ROADMAP", title: "A" } });
    const b = await db.node.create({ data: { view: "ROADMAP", title: "B" } });

    await db.edge.create({ data: { fromId: a.id, toId: b.id, kind: "DEPENDS" } });

    await expect(
      db.edge.create({ data: { fromId: a.id, toId: b.id, kind: "DEPENDS" } }),
    ).rejects.toMatchObject({ code: "P2002" });

    // same pair, different kind is allowed
    await expect(
      db.edge.create({ data: { fromId: a.id, toId: b.id, kind: "RELATES" } }),
    ).resolves.toBeTruthy();
  });

  it("cascade-deletes edges when an endpoint node is removed", async () => {
    const a = await db.node.create({ data: { view: "ROADMAP", title: "A" } });
    const b = await db.node.create({ data: { view: "ROADMAP", title: "B" } });
    await db.edge.create({ data: { fromId: a.id, toId: b.id } });

    await db.node.delete({ where: { id: a.id } });

    expect(await db.edge.count()).toBe(0);
  });
});

describe("Bug <-> Node link", () => {
  it("links a bug to a node and nulls the link on node delete (LGPD-style detach)", async () => {
    const node = await db.node.create({
      data: { view: "ROADMAP", cluster: "EMERGENCY", title: "Close public bucket" },
    });
    const bug = await db.bug.create({
      data: {
        title: "Public uploads bucket",
        severity: "critical",
        sourceRef: "supabase/migrations/20260106164511_*.sql:4-6",
        nodeId: node.id,
      },
    });

    expect(bug.nodeId).toBe(node.id);

    await db.node.delete({ where: { id: node.id } });

    const after = await db.bug.findUnique({ where: { id: bug.id } });
    expect(after).not.toBeNull();
    expect(after!.nodeId).toBeNull();
  });
});

describe("Tag M:N", () => {
  it("attaches tags to a node and queries them both ways", async () => {
    const node = await db.node.create({
      data: {
        view: "ARCHITECTURE",
        title: "Semantic search",
        tags: {
          create: [{ label: "search" }, { label: "ai" }],
        },
      },
      include: { tags: true },
    });
    expect(node.tags.map((t) => t.label).sort()).toEqual(["ai", "search"]);

    const tag = await db.tag.findUnique({
      where: { label: "search" },
      include: { nodes: true },
    });
    expect(tag!.nodes).toHaveLength(1);
    expect(tag!.nodes[0].id).toBe(node.id);
  });
});
