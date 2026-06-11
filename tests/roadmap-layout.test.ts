import { describe, expect, it } from "bun:test";
import { layoutRoadmap, type RoadmapLayoutNode } from "@/lib/roadmap-layout";

const f = (
  id: string,
  over: Partial<RoadmapLayoutNode> = {},
): RoadmapLayoutNode => ({
  id,
  parentId: null,
  cluster: null,
  status: "PENDING",
  priority: 2,
  ...over,
});

// Wide band + fixed dims so single-feature lanes land at predictable x's: each lane is one
// column wide (colW) plus a laneGap before the next.
const OPTS = { colW: 300, rowH: 100, laneGap: 50, maxBandW: 100000 };

describe("layoutRoadmap (grid-block lanes)", () => {
  it("places each cluster lane as its own block, alphabetical with unset last", () => {
    const nodes = [
      f("a", { cluster: "SEARCH" }),
      f("b", { cluster: "AUTH" }),
      f("c", { cluster: null }),
    ];
    const pos = layoutRoadmap(nodes, "cluster", OPTS);
    expect(pos.get("b")!.x).toBe(0); // AUTH lane
    expect(pos.get("a")!.x).toBe(350); // SEARCH lane (colW 300 + laneGap 50)
    expect(pos.get("c")!.x).toBe(700); // unset "—" lane last
  });

  it("orders status lanes Now → Next → Later", () => {
    const nodes = [
      f("done", { status: "DONE" }),
      f("pend", { status: "PENDING" }),
      f("wip", { status: "IN_PROGRESS" }),
    ];
    const pos = layoutRoadmap(nodes, "status", OPTS);
    expect(pos.get("wip")!.x).toBe(0);
    expect(pos.get("pend")!.x).toBe(350);
    expect(pos.get("done")!.x).toBe(700);
  });

  it("orders priority lanes 0 → 3 (critical first)", () => {
    const nodes = [f("low", { priority: 3 }), f("crit", { priority: 0 })];
    const pos = layoutRoadmap(nodes, "priority", OPTS);
    expect(pos.get("crit")!.x).toBe(0);
    expect(pos.get("low")!.x).toBe(350);
  });

  it("packs a busy lane into a multi-column grid block (masonry), not one tall strip", () => {
    // 4 single features in one lane → ceil(sqrt(4)) = 2 columns, balanced 2×2.
    const nodes = ["f1", "f2", "f3", "f4"].map((id) => f(id, { cluster: "AUTH" }));
    const pos = layoutRoadmap(nodes, "cluster", OPTS);
    expect(pos.get("f1")).toEqual({ x: 0, y: 0 }); // col 0, row 0
    expect(pos.get("f2")).toEqual({ x: 300, y: 0 }); // col 1, row 0
    expect(pos.get("f3")).toEqual({ x: 0, y: 100 }); // col 0, row 1
    expect(pos.get("f4")).toEqual({ x: 300, y: 100 }); // col 1, row 1
  });

  it("stacks sub-tasks beneath their parent inside its grid cell", () => {
    const nodes = [
      f("parent", { cluster: "AUTH" }),
      f("k1", { parentId: "parent", cluster: "SEARCH" }), // child's own cluster ignored
      f("k2", { parentId: "parent", cluster: "SEARCH" }),
    ];
    const pos = layoutRoadmap(nodes, "cluster", { ...OPTS, childIndent: 24 });
    const p = pos.get("parent")!;
    expect(pos.get("k1")).toEqual({ x: p.x + 24, y: p.y + 100 });
    expect(pos.get("k2")).toEqual({ x: p.x + 24, y: p.y + 200 });
  });

  it("in a single-column lane, reserves room for a feature's children below it", () => {
    const nodes = [
      f("p1", { cluster: "AUTH" }),
      f("c1", { parentId: "p1" }),
      f("c2", { parentId: "p1" }),
      f("p2", { cluster: "AUTH" }),
    ];
    // maxCols 1 forces a single column → p2 must sit below p1 + its 2 children.
    const pos = layoutRoadmap(nodes, "cluster", { ...OPTS, maxCols: 1 });
    expect(pos.get("p2")!.y).toBe(300); // 3 row-slots * 100
    expect(pos.get("p2")!.x).toBe(0);
  });

  it("wraps lane blocks into a new band once a band fills up", () => {
    const nodes = [
      f("a", { cluster: "AAA" }),
      f("b", { cluster: "BBB" }),
      f("c", { cluster: "CCC" }),
    ];
    // Each lane is 300 wide; maxBandW 350 fits one lane per band → b and c wrap down.
    const pos = layoutRoadmap(nodes, "cluster", { ...OPTS, maxBandW: 350 });
    expect(pos.get("a")).toEqual({ x: 0, y: 0 });
    expect(pos.get("b")!.x).toBe(0);
    expect(pos.get("b")!.y).toBeGreaterThan(0); // wrapped to band 2
    expect(pos.get("c")!.y).toBeGreaterThan(pos.get("b")!.y); // band 3
  });

  it("treats a child whose parent isn't on the board as a top-level feature", () => {
    const nodes = [f("orphan", { parentId: "ghost", cluster: "AUTH" })];
    const pos = layoutRoadmap(nodes, "cluster", OPTS);
    expect(pos.get("orphan")).toEqual({ x: 0, y: 0 });
  });

  it("groups by layer in frontend → backend → fullstack → unset order", () => {
    const nodes = [
      f("none"),
      f("fs", { layer: "fullstack" }),
      f("be", { layer: "backend" }),
      f("fe", { layer: "frontend" }),
    ];
    const pos = layoutRoadmap(nodes, "layer", OPTS);
    // One single-feature lane per layer: lanes flow left→right in the fixed order.
    expect(pos.get("fe")!.x).toBeLessThan(pos.get("be")!.x);
    expect(pos.get("be")!.x).toBeLessThan(pos.get("fs")!.x);
    expect(pos.get("fs")!.x).toBeLessThan(pos.get("none")!.x); // unset "—" lane last
  });

  it("buckets a sloppily-cased layer with its normalized lane", () => {
    const nodes = [f("a", { layer: "Frontend" }), f("b", { layer: "frontend" })];
    const pos = layoutRoadmap(nodes, "layer", OPTS);
    // Same lane → same x (single column), stacked rows.
    expect(pos.get("a")!.x).toBe(pos.get("b")!.x);
  });
});
