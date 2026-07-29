import { describe, expect, it } from "bun:test";
import {
  GROUP_FIELD,
  buildColumns,
  columnValue,
  dependencyGraph,
  groupKey,
  type GroupableNode,
} from "@/lib/board-grouping";

// The columns board computes its layout at RENDER time from these functions — nothing here
// reads or writes an x/y, which is the whole point of the view. See components/columns/.

function node(id: string, over: Partial<GroupableNode> = {}): GroupableNode {
  return { id, status: "PENDING", priority: 2, cluster: null, layer: null, ...over };
}

const NODES: GroupableNode[] = [
  node("a", { status: "IN_PROGRESS", priority: 0, cluster: "AUTH", layer: "frontend" }),
  node("b", { status: "PENDING", priority: 1, cluster: "AUTH", layer: "backend" }),
  node("c", { status: "DONE", priority: 3, cluster: "DATA", layer: "fullstack" }),
  node("d", { status: "PENDING", priority: 1, cluster: null, layer: null }),
];

const keysOf = (cols: { key: string }[]) => cols.map((c) => c.key);
const idsIn = (cols: { key: string; cards: GroupableNode[] }[], key: string) =>
  cols.find((c) => c.key === key)?.cards.map((n) => n.id) ?? [];

describe("groupKey", () => {
  it("reads the value of each dimension, normalizing layer aliases", () => {
    const n = node("x", { status: "DONE", priority: 0, cluster: " AUTH ", layer: "FE" });
    expect(groupKey(n, "status")).toBe("DONE");
    expect(groupKey(n, "priority")).toBe("0");
    expect(groupKey(n, "category")).toBe("AUTH");
    expect(groupKey(n, "layer")).toBe("frontend");
  });

  it("maps an unset category/layer to the empty key", () => {
    const n = node("x", { cluster: "   ", layer: "nonsense" });
    expect(groupKey(n, "category")).toBe("");
    expect(groupKey(n, "layer")).toBe("");
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

  it("drops empty columns when asked", () => {
    const cols = buildColumns(NODES, "status", { hideEmpty: true });
    expect(keysOf(cols)).toEqual(["PENDING", "IN_PROGRESS", "DONE"]);
  });

  it("appends a column for an off-list status rather than losing the card", () => {
    const cols = buildColumns([...NODES, node("z", { status: "KEEP" })], "status", {
      hideEmpty: true,
    });
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
    expect(GROUP_FIELD.priority).toBe("priority");
  });
});

describe("buildColumns — category", () => {
  it("derives columns from the data (categories are free-form), sorted, unset last", () => {
    const cols = buildColumns(NODES, "category");
    expect(keysOf(cols)).toEqual(["AUTH", "DATA", ""]);
    expect(idsIn(cols, "AUTH")).toEqual(["a", "b"]);
    expect(idsIn(cols, "")).toEqual(["d"]);
    expect(cols[2].label).toBe("No category");
    expect(cols[2].value).toBeNull();
  });

  it("writes Node.cluster, not a field named 'category'", () => {
    expect(GROUP_FIELD.category).toBe("cluster");
    expect(columnValue("category", "AUTH")).toBe("AUTH");
    expect(columnValue("category", "")).toBeNull();
  });

  it("has no unset column when every card is categorized", () => {
    const cols = buildColumns(NODES.slice(0, 3), "category");
    expect(keysOf(cols)).toEqual(["AUTH", "DATA"]);
  });
});

describe("buildColumns — layer", () => {
  it("offers the three layers plus an unset column", () => {
    const cols = buildColumns(NODES, "layer");
    expect(keysOf(cols)).toEqual(["frontend", "backend", "fullstack", ""]);
    expect(idsIn(cols, "frontend")).toEqual(["a"]);
    expect(idsIn(cols, "")).toEqual(["d"]);
    expect(cols[3].label).toBe("No layer");
  });
});

describe("buildColumns — card order", () => {
  it("sorts by priority, keeping the incoming (createdAt) order as the tie-break", () => {
    const cards = [
      node("late-p0", { priority: 0 }),
      node("early-p3", { priority: 3 }),
      node("mid-p0", { priority: 0 }),
    ];
    const cols = buildColumns(cards, "status", { hideEmpty: true });
    expect(cols[0].cards.map((n) => n.id)).toEqual(["late-p0", "mid-p0", "early-p3"]);
  });

  it("returns an empty column list for no nodes when hiding empties", () => {
    expect(buildColumns([], "category", { hideEmpty: true })).toEqual([]);
    expect(buildColumns([], "category")).toEqual([]);
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
