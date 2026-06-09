import { beforeEach, describe, expect, it } from "bun:test";
import { count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node, edge, tag, nodeTags } from "@/lib/drizzle/schema";
import { resetDb } from "./helpers";

beforeEach(resetDb);

describe("Node tree", () => {
  it("creates a node with children and reads them back", async () => {
    const [parent] = await db
      .insert(node)
      .values({ view: "ROADMAP", cluster: "FRONT_2", title: "Introduce office/org" })
      .returning();
    await db.insert(node).values([
      { view: "ROADMAP", cluster: "FRONT_2", title: "Member invites", parentId: parent.id },
      { view: "ROADMAP", cluster: "FRONT_2", title: "Encrypt API keys", parentId: parent.id },
    ]);

    const children = await db.query.node.findMany({
      where: (t, { eq }) => eq(t.parentId, parent.id),
    });
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.parentId)).toEqual([parent.id, parent.id]);
  });

  it("cascade-deletes the subtree when a parent is removed", async () => {
    const [parent] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Front" })
      .returning();
    const [child] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Task", parentId: parent.id })
      .returning();
    const childId = child.id;

    await db.delete(node).where(eq(node.id, parent.id));

    expect(await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, childId) })).toBeUndefined();
    expect((await db.select({ n: count() }).from(node))[0].n).toBe(0);
  });
});

describe("Edge", () => {
  it("enforces the (from,to,kind) unique constraint", async () => {
    const [a] = await db.insert(node).values({ view: "ROADMAP", title: "A" }).returning();
    const [b] = await db.insert(node).values({ view: "ROADMAP", title: "B" }).returning();

    await db.insert(edge).values({ fromId: a.id, toId: b.id, kind: "DEPENDS" });

    // A duplicate (from,to,kind) violates the unique index — the insert rejects.
    await expect(
      Promise.resolve(db.insert(edge).values({ fromId: a.id, toId: b.id, kind: "DEPENDS" })),
    ).rejects.toThrow();

    // same pair, different kind is allowed
    const [other] = await db
      .insert(edge)
      .values({ fromId: a.id, toId: b.id, kind: "RELATES" })
      .returning();
    expect(other).toBeTruthy();
  });

  it("cascade-deletes edges when an endpoint node is removed", async () => {
    const [a] = await db.insert(node).values({ view: "ROADMAP", title: "A" }).returning();
    const [b] = await db.insert(node).values({ view: "ROADMAP", title: "B" }).returning();
    await db.insert(edge).values({ fromId: a.id, toId: b.id });

    await db.delete(node).where(eq(node.id, a.id));

    expect((await db.select({ n: count() }).from(edge))[0].n).toBe(0);
  });
});

describe("Tag M:N", () => {
  it("attaches tags to a node and queries them both ways", async () => {
    const [created] = await db
      .insert(node)
      .values({ view: "ARCHITECTURE", title: "Semantic search" })
      .returning();
    const tagRows = await db.insert(tag).values([{ label: "search" }, { label: "ai" }]).returning();
    await db.insert(nodeTags).values(tagRows.map((t) => ({ a: created.id, b: t.id })));

    const withTags = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.id, created.id),
      with: { nodeTags: { with: { tag: true } } },
    });
    expect(withTags!.nodeTags.map((nt) => nt.tag.label).sort()).toEqual(["ai", "search"]);

    const searchTag = await db.query.tag.findFirst({
      where: (t, { eq }) => eq(t.label, "search"),
      with: { nodeTags: { with: { node: true } } },
    });
    expect(searchTag!.nodeTags).toHaveLength(1);
    expect(searchTag!.nodeTags[0].node.id).toBe(created.id);
  });
});
