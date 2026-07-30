import { describe, expect, it } from "bun:test";
import {
  GROUP_BYS,
  UNSET_KEY,
  buildColumns,
  columnValue,
  dependencyGraph,
  groupKey,
  type GroupableNode,
} from "@/lib/board-grouping";
import { roadmapLaneKey } from "@/lib/roadmap-layout";

// The columns board computes its layout at RENDER time from these functions — nothing here
// reads or writes an x/y, which is the whole point of the view. See components/columns/.

function node(id: string, over: Partial<GroupableNode> = {}): GroupableNode {
  return { id, parentId: null, status: "PENDING", priority: 2, cluster: null, ...over };
}

const NODES: GroupableNode[] = [
  node("a", { status: "IN_PROGRESS", priority: 0, cluster: "AUTH" }),
  node("b", { status: "PENDING", priority: 1, cluster: "AUTH" }),
  node("c", { status: "DONE", priority: 3, cluster: "DATA" }),
  node("d", { status: "PENDING", priority: 1, cluster: null }),
];

const keysOf = (cols: { key: string }[]) => cols.map((c) => c.key);
const idsIn = (cols: { key: string; cards: GroupableNode[] }[], key: string) =>
  cols.find((c) => c.key === key)?.cards.map((n) => n.id) ?? [];
/** Hide-empty is the COLUMNS COMPONENT's own local lens, not a buildColumns option. */
const nonEmpty = <T extends { cards: unknown[] }>(cols: T[]) => cols.filter((c) => c.cards.length);

describe("groupKey", () => {
  it("reads the value of each dimension", () => {
    const n = node("x", { status: "DONE", priority: 0, cluster: " AUTH " });
    expect(groupKey(n, "status")).toBe("DONE");
    expect(groupKey(n, "priority")).toBe("0");
    expect(groupKey(n, "cluster")).toBe("AUTH");
  });

  // ONE vocabulary with the canvas lanes: the dimensions carry the SAME names (the Node column
  // each one writes — `cluster`, never a second word for it), and the unset bucket has ONE key
  // instead of "" here and "—" there.
  it("names its dimensions and its unset bucket exactly as the canvas lanes do", () => {
    expect([...GROUP_BYS].sort()).toEqual(["cluster", "priority", "status"]);
    const n = node("x", { cluster: "   " });
    expect(groupKey(n, "cluster")).toBe(UNSET_KEY);
    expect(groupKey(n, "cluster")).toBe(
      roadmapLaneKey("cluster", { ...n, stateName: null, teamKey: null }),
    );
    expect(groupKey(n, "priority")).toBe(
      roadmapLaneKey("priority", { ...n, stateName: null, teamKey: null }),
    );
    expect(columnValue("cluster", UNSET_KEY)).toBeNull();
  });
});

describe("buildColumns — status", () => {
  it("uses the fixed roadmap status set, in order, even when empty", () => {
    const cols = buildColumns(NODES, "status");
    expect(keysOf(cols)).toEqual([
      "PENDING",
      "IN_PROGRESS",
      "DONE",
      "BLOCKED",
      "CANCELLED",
      "DEPRIORITIZED",
    ]);
    expect(idsIn(cols, "PENDING")).toEqual(["b", "d"]);
    expect(idsIn(cols, "IN_PROGRESS")).toEqual(["a"]);
    expect(idsIn(cols, "BLOCKED")).toEqual([]);
  });

  it("appends a column for an off-list status rather than losing the card", () => {
    const cols = nonEmpty(buildColumns([...NODES, node("z", { status: "KEEP" })], "status"));
    expect(keysOf(cols)).toEqual(["PENDING", "IN_PROGRESS", "DONE", "KEEP"]);
  });

  it("labels and colors each column", () => {
    const done = buildColumns(NODES, "status").find((c) => c.key === "DONE")!;
    expect(done.label).toBe("Done");
    expect(done.color).toBe("#34d399");
    expect(done.value).toBe("DONE");
  });
});

describe("buildColumns — priority", () => {
  it("always offers P0…P3 in order", () => {
    const cols = buildColumns(NODES, "priority");
    expect(keysOf(cols)).toEqual(["0", "1", "2", "3"]);
    expect(idsIn(cols, "1")).toEqual(["b", "d"]);
    expect(idsIn(cols, "2")).toEqual([]);
    expect(cols[0].label).toBe("P0 · critical");
  });

  it("carries a NUMBER as the drop value (Node.priority is numeric)", () => {
    const cols = buildColumns(NODES, "priority");
    expect(cols.map((c) => c.value)).toEqual([0, 1, 2, 3]);
  });
});

describe("buildColumns — cluster (the category dimension)", () => {
  it("derives columns from the data (categories are free-form), sorted, unset last", () => {
    const cols = buildColumns(NODES, "cluster");
    expect(keysOf(cols)).toEqual(["AUTH", "DATA", UNSET_KEY]);
    expect(idsIn(cols, "AUTH")).toEqual(["a", "b"]);
    expect(idsIn(cols, UNSET_KEY)).toEqual(["d"]);
    expect(cols[2].label).toBe("No category");
    expect(cols[2].value).toBeNull();
  });

  it("writes the free-text value, and clears the field from the unset column", () => {
    expect(columnValue("cluster", "AUTH")).toBe("AUTH");
    expect(columnValue("cluster", UNSET_KEY)).toBeNull();
  });

  it("has no unset column when every card is categorized", () => {
    const cols = buildColumns(NODES.slice(0, 3), "cluster");
    expect(keysOf(cols)).toEqual(["AUTH", "DATA"]);
  });
});

describe("buildColumns — card order", () => {
  it("sorts by priority, keeping the incoming (createdAt) order as the tie-break", () => {
    const cards = [
      node("late-p0", { priority: 0 }),
      node("early-p3", { priority: 3 }),
      node("mid-p0", { priority: 0 }),
    ];
    const cols = nonEmpty(buildColumns(cards, "status"));
    expect(cols[0].cards.map((n) => n.id)).toEqual(["late-p0", "mid-p0", "early-p3"]);
  });

  it("returns an empty column list for no nodes on a data-derived dimension", () => {
    expect(buildColumns([], "cluster")).toEqual([]);
  });
});

describe("buildColumns — sub-tasks", () => {
  // Owner ruling, reversing the earlier top-level-only rule: sub-issues get their OWN card, in the
  // column their OWN field puts them in — exactly Linear's board — with the parent named above the
  // title (ColumnCard's `parentTitle`). Holding them back left columns reading as empty while real
  // work sat inside them.
  const withKids = [
    node("parent", { status: "IN_PROGRESS", cluster: "AUTH", priority: 0 }),
    node("kid-1", { parentId: "parent", status: "DONE", cluster: "AUTH", priority: 0 }),
    node("kid-2", { parentId: "parent", status: "PENDING", cluster: "DATA", priority: 1 }),
    node("other", { status: "PENDING", cluster: "DATA", priority: 1 }),
  ];

  it("gives a sub-task a card of its own, in every dimension", () => {
    for (const by of GROUP_BYS) {
      const ids = buildColumns(withKids, by).flatMap((c) => c.cards.map((n) => n.id));
      expect(ids.sort()).toEqual(["kid-1", "kid-2", "other", "parent"]);
    }
  });

  it("files a child by its OWN field, not its parent's", () => {
    const cols = nonEmpty(buildColumns(withKids, "cluster"));
    expect(keysOf(cols)).toEqual(["AUTH", "DATA"]);
    expect(idsIn(cols, "AUTH").sort()).toEqual(["kid-1", "parent"]);
    expect(idsIn(cols, "DATA").sort()).toEqual(["kid-2", "other"]); // kid-2 is DATA, parent is AUTH
  });

  it("fills a column that only sub-tasks land in", () => {
    const cols = nonEmpty(
      buildColumns([node("p"), node("k", { parentId: "p", status: "DONE" })], "status"),
    );
    expect(keysOf(cols)).toEqual(["PENDING", "DONE"]); // canonical status order, not data order
    expect(idsIn(cols, "DONE")).toEqual(["k"]);
  });
});

describe("dependencyGraph", () => {
  const nodes = [
    node("a", { status: "PENDING" }),
    node("b", { status: "DONE" }),
    node("c", { status: "PENDING" }),
    node("d", { status: "PENDING" }),
  ];
  // a DEPENDS ON b (done) · b DEPENDS ON c (pending) · d DEPENDS ON c (pending)
  const edges = [
    { fromId: "a", toId: "b", kind: "DEPENDS" },
    { fromId: "b", toId: "c", kind: "DEPENDS" },
    { fromId: "d", toId: "c", kind: "DEPENDS" },
  ];

  it("blocks a card whose dependency is not DONE", () => {
    const g = dependencyGraph(nodes, edges);
    expect(g.blocked.has("d")).toBe(true);
    expect(g.blocked.has("b")).toBe(true);
  });

  it("does NOT block a card whose only dependency is DONE", () => {
    expect(dependencyGraph(nodes, edges).blocked.has("a")).toBe(false);
  });

  it("does NOT block a card whose only dependency was CANCELLED", () => {
    // Same rule as lib/work-next.ts (DONE *or* CANCELLED satisfies). Diverging here put a BLOCKED
    // chip on the exact card the canvas ranked #1 in the work order.
    const g = dependencyGraph(
      [node("x"), node("dead", { status: "CANCELLED" })],
      [{ fromId: "x", toId: "dead", kind: "DEPENDS" }],
    );
    expect(g.blocked.has("x")).toBe(false);
    expect(g.blockedBy.x).toEqual(["dead"]); // still LISTED as a dependency, just not blocking
  });

  it("still resolves a dependency pointing at a sub-task", () => {
    const g = dependencyGraph(
      [node("top"), node("kid", { parentId: "top-2", status: "PENDING" })],
      [{ fromId: "top", toId: "kid", kind: "DEPENDS" }],
    );
    expect(g.blocked.has("top")).toBe(true);
  });

  it("is single-hop: a satisfied dependency that is itself blocked does not propagate", () => {
    // a → b (DONE) → c (PENDING). a stays startable; only b is blocked.
    const g = dependencyGraph(nodes, edges);
    expect(g.blocked.has("a")).toBe(false);
    expect(g.blockedBy.a).toEqual(["b"]);
  });

  it("records both directions", () => {
    const g = dependencyGraph(nodes, edges);
    expect(g.blockedBy.b).toEqual(["c"]);
    expect(g.blocks.c).toEqual(["b", "d"]);
    expect(g.blocks.a ?? []).toEqual([]);
  });

  it("ignores non-DEPENDS edges, self-edges and dangling endpoints", () => {
    const g = dependencyGraph(nodes, [
      { fromId: "a", toId: "c", kind: "RELATES" },
      { fromId: "a", toId: "a", kind: "DEPENDS" },
      { fromId: "a", toId: "ghost", kind: "DEPENDS" },
      { fromId: "ghost", toId: "c", kind: "DEPENDS" },
    ]);
    expect(g.blocked.size).toBe(0);
    expect(g.blockedBy.a ?? []).toEqual([]);
  });

  it("de-duplicates repeated edges", () => {
    const g = dependencyGraph(nodes, [
      { fromId: "d", toId: "c", kind: "DEPENDS" },
      { fromId: "d", toId: "c", kind: "DEPENDS" },
    ]);
    expect(g.blockedBy.d).toEqual(["c"]);
    expect(g.blocks.c).toEqual(["d"]);
  });

  it("has no blocked cards when there are no edges", () => {
    const g = dependencyGraph(nodes, []);
    expect(g.blocked.size).toBe(0);
    expect(Object.keys(g.blockedBy)).toEqual([]);
  });
});
