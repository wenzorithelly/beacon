import { describe, expect, it } from "bun:test";
import { collapsedDescendants, childCounts } from "@/lib/node-collapse";

// A(parent) → B, C ; B → D (grandchild) ; E standalone.
const nodes = [
  { id: "A", parentId: null },
  { id: "B", parentId: "A" },
  { id: "C", parentId: "A" },
  { id: "D", parentId: "B" },
  { id: "E", parentId: null },
];

describe("collapsedDescendants", () => {
  it("hides the WHOLE subtree of a collapsed node (any depth), parent stays visible", () => {
    expect(collapsedDescendants(nodes, new Set(["A"]))).toEqual(new Set(["B", "C", "D"]));
  });

  it("hides only the subtree of the collapsed node", () => {
    expect(collapsedDescendants(nodes, new Set(["B"]))).toEqual(new Set(["D"]));
  });

  it("returns empty when nothing is collapsed", () => {
    expect(collapsedDescendants(nodes, new Set())).toEqual(new Set());
  });

  it("is idempotent when a node and its descendant are both collapsed", () => {
    expect(collapsedDescendants(nodes, new Set(["A", "B"]))).toEqual(new Set(["B", "C", "D"]));
  });

  it("terminates on a malformed parent cycle", () => {
    const cyclic = [
      { id: "X", parentId: "Y" },
      { id: "Y", parentId: "X" },
    ];
    // Should not infinite-loop; both are each other's descendant.
    expect(collapsedDescendants(cyclic, new Set(["X"]))).toEqual(new Set(["X", "Y"]));
  });
});

describe("childCounts", () => {
  it("counts direct children only", () => {
    const c = childCounts(nodes);
    expect(c.get("A")).toBe(2);
    expect(c.get("B")).toBe(1);
    expect(c.get("E")).toBeUndefined();
  });
});
