import { describe, expect, it } from "bun:test";
import {
  forceLayoutRoadmap,
  type ForceLayoutEdge,
  type ForceLayoutNode,
} from "@/lib/roadmap-force-layout";

const dist = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => Math.hypot(a.x - b.x, a.y - b.y);

describe("forceLayoutRoadmap (organic 2D layout)", () => {
  it("positions every node", () => {
    const nodes: ForceLayoutNode[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const pos = forceLayoutRoadmap(nodes, []);
    expect(pos.size).toBe(3);
    for (const n of nodes) expect(pos.get(n.id)).toBeDefined();
  });

  it("is deterministic — the same graph yields the same layout", () => {
    const nodes: ForceLayoutNode[] = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const edges: ForceLayoutEdge[] = [{ fromId: "b", toId: "a" }, { fromId: "c", toId: "a" }];
    const first = forceLayoutRoadmap(nodes, edges);
    const second = forceLayoutRoadmap(nodes, edges);
    for (const n of nodes) {
      expect(second.get(n.id)).toEqual(first.get(n.id));
    }
  });

  it("pulls dependency-linked features into a tight cluster vs. unrelated ones", () => {
    // A hub with 4 dependents, plus 4 unrelated isolated features.
    const nodes: ForceLayoutNode[] = [
      { id: "hub" },
      { id: "dep1" }, { id: "dep2" }, { id: "dep3" }, { id: "dep4" },
      { id: "iso1" }, { id: "iso2" }, { id: "iso3" }, { id: "iso4" },
    ];
    const edges: ForceLayoutEdge[] = [
      { fromId: "dep1", toId: "hub" },
      { fromId: "dep2", toId: "hub" },
      { fromId: "dep3", toId: "hub" },
      { fromId: "dep4", toId: "hub" },
    ];
    const pos = forceLayoutRoadmap(nodes, edges);
    const hub = pos.get("hub")!;
    const avgDep =
      (["dep1", "dep2", "dep3", "dep4"] as const)
        .map((id) => dist(hub, pos.get(id)!))
        .reduce((a, b) => a + b, 0) / 4;
    const avgIso =
      (["iso1", "iso2", "iso3", "iso4"] as const)
        .map((id) => dist(hub, pos.get(id)!))
        .reduce((a, b) => a + b, 0) / 4;
    expect(avgDep).toBeLessThan(avgIso);
  });

  it("spreads independent features in 2D (uses width, not a single row or column)", () => {
    const nodes: ForceLayoutNode[] = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}` }));
    const pos = forceLayoutRoadmap(nodes, []);
    const xs = new Set([...pos.values()].map((p) => p.x));
    const ys = new Set([...pos.values()].map((p) => p.y));
    expect(xs.size).toBeGreaterThan(1);
    expect(ys.size).toBeGreaterThan(1);
  });
});
