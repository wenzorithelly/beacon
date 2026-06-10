import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import * as m from "@/lib/mutations";
import {
  createBugFlag,
  deleteBugFlag,
  listBugFlags,
  updateBugFlag,
} from "@/lib/bug-flags";
import { resetDb } from "./helpers";

beforeEach(resetDb);

async function archNode(title = "Some component") {
  return m.createNode({ view: "ARCHITECTURE", title });
}

describe("createBugFlag", () => {
  it("creates an open flag raised by the user", async () => {
    const n = await archNode();
    const flag = await createBugFlag({ nodeId: n.id, by: "user", note: "races on save" });
    expect(flag.nodeId).toBe(n.id);
    expect(flag.by).toBe("user");
    expect(flag.note).toBe("races on save");
    expect(flag.resolvedAt).toBeNull();
  });

  it("accepts by=agent", async () => {
    const n = await archNode();
    const flag = await createBugFlag({ nodeId: n.id, by: "agent", note: "found a leak" });
    expect(flag.by).toBe("agent");
  });

  it("rejects an unknown `by`", async () => {
    const n = await archNode();
    await expect(
      // @ts-expect-error — deliberately invalid
      createBugFlag({ nodeId: n.id, by: "robot", note: "x" }),
    ).rejects.toBeTruthy();
  });

  it("rejects an empty note", async () => {
    const n = await archNode();
    await expect(createBugFlag({ nodeId: n.id, by: "user", note: "  " })).rejects.toBeTruthy();
  });

  it("rejects a nodeId that doesn't exist", async () => {
    await expect(createBugFlag({ nodeId: "nope", by: "user", note: "x" })).rejects.toBeTruthy();
  });
});

describe("listBugFlags", () => {
  it("filters by nodeId and open", async () => {
    const a = await archNode("A");
    const b = await archNode("B");
    await createBugFlag({ nodeId: a.id, by: "user", note: "one" });
    const two = await createBugFlag({ nodeId: a.id, by: "agent", note: "two" });
    await createBugFlag({ nodeId: b.id, by: "user", note: "three" });
    await updateBugFlag(two.id, { resolved: true });

    expect((await listBugFlags()).length).toBe(3);
    expect((await listBugFlags({ nodeId: a.id })).length).toBe(2);
    const open = await listBugFlags({ nodeId: a.id, open: true });
    expect(open.length).toBe(1);
    expect(open[0].note).toBe("one");
  });
});

describe("updateBugFlag", () => {
  it("resolves and reopens", async () => {
    const n = await archNode();
    const flag = await createBugFlag({ nodeId: n.id, by: "user", note: "x" });
    const resolved = await updateBugFlag(flag.id, { resolved: true });
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    const reopened = await updateBugFlag(flag.id, { resolved: false });
    expect(reopened.resolvedAt).toBeNull();
  });

  it("edits the note", async () => {
    const n = await archNode();
    const flag = await createBugFlag({ nodeId: n.id, by: "user", note: "old" });
    expect((await updateBugFlag(flag.id, { note: "new" })).note).toBe("new");
  });
});

describe("deleteBugFlag", () => {
  it("removes the flag", async () => {
    const n = await archNode();
    const flag = await createBugFlag({ nodeId: n.id, by: "user", note: "x" });
    await deleteBugFlag(flag.id);
    expect(await listBugFlags({ nodeId: n.id })).toEqual([]);
  });

  it("cascades when the node is deleted", async () => {
    const n = await archNode();
    await createBugFlag({ nodeId: n.id, by: "user", note: "x" });
    await m.deleteNode(n.id);
    expect(await listBugFlags()).toEqual([]);
  });
});

describe("node kind (bug cards on the roadmap)", () => {
  it("defaults kind to FEATURE", async () => {
    const n = await m.createNode({ view: "ROADMAP", title: "Plain feature" });
    expect(n.kind).toBe("FEATURE");
  });

  it("creates a BUG node", async () => {
    const n = await m.createNode({ view: "ROADMAP", title: "Crash on save", kind: "BUG" });
    expect(n.kind).toBe("BUG");
    expect(n.status).toBe("PENDING");
  });

  it("rejects an invalid kind", async () => {
    await expect(
      // @ts-expect-error — deliberately invalid
      m.createNode({ view: "ROADMAP", title: "x", kind: "TASK" }),
    ).rejects.toBeTruthy();
  });

  it("can reclassify a card via updateNode", async () => {
    const n = await m.createNode({ view: "ROADMAP", title: "Oops, actually a bug" });
    expect((await m.updateNode(n.id, { kind: "BUG" })).kind).toBe("BUG");
  });

  it("keeps the bugFlag table clean on reset", async () => {
    // resetDb (used by every data suite) must clear BugFlag rows too.
    const n = await archNode();
    await createBugFlag({ nodeId: n.id, by: "user", note: "x" });
    await resetDb();
    expect(await listBugFlags()).toEqual([]);
    expect(await db.query.node.findMany()).toEqual([]);
  });
});
