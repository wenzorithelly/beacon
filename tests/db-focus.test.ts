import { describe, expect, it } from "bun:test";
import { neighborIds } from "@/components/graph/db-types";

// neighborIds powers click-to-highlight on /db: clicking a node fades everything
// that isn't the node itself or directly linked to it by an edge.
describe("neighborIds", () => {
  const edges = [
    { source: "ep1", target: "orders" }, // endpoint -> table
    { source: "orders", target: "users" }, // FK
    { source: "ep2", target: "users" }, // unrelated endpoint -> table
  ];

  it("includes the selected node plus everything it links to (either direction)", () => {
    expect(neighborIds("orders", edges)).toEqual(new Set(["orders", "ep1", "users"]));
  });

  it("returns just the node itself when it has no edges", () => {
    expect(neighborIds("lonely", edges)).toEqual(new Set(["lonely"]));
  });

  it("does not pull in nodes connected only to others", () => {
    // ep2 links to users, not to orders, so selecting orders must not surface ep2
    expect(neighborIds("orders", edges).has("ep2")).toBe(false);
  });
});
