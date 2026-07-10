import { describe, expect, it } from "bun:test";
import {
  estimateRoadmapCardHeight,
  layoutRoadmap,
  statusLaneKey,
  type RoadmapLayoutNode,
} from "@/lib/roadmap-layout";

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

// Huge minBandW + fixed dims so every lane stays on ONE band and single-feature lanes land at
// predictable x's: each lane is one column wide (colW) plus a laneGap before the next.
const OPTS = { colW: 300, rowH: 100, laneGap: 50, minBandW: 100000 };

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

  it("wraps lane blocks into new bands when they can't fit one band", () => {
    // Many single-feature lanes (300 wide each) can't fit one band on a normal viewport, so they
    // wrap — more than one distinct band-top proves the wrapping (exact width is viewport-derived).
    const nodes = Array.from({ length: 12 }, (_, i) =>
      f(`n${i}`, { cluster: `C${String(i).padStart(2, "0")}` }),
    );
    const pos = layoutRoadmap(nodes, "cluster", {
      colW: 300,
      rowH: 100,
      laneGap: 50,
      viewportAspect: 1.0,
    });
    const bandTops = new Set([...pos.values()].map((p) => p.y));
    expect(bandTops.size).toBeGreaterThan(1);
    // First lane anchors the first band at the origin.
    expect(pos.get("n0")).toEqual({ x: 0, y: 0 });
  });

  it("treats a child whose parent isn't on the board as a top-level feature", () => {
    const nodes = [f("orphan", { parentId: "ghost", cluster: "AUTH" })];
    const pos = layoutRoadmap(nodes, "cluster", OPTS);
    expect(pos.get("orphan")).toEqual({ x: 0, y: 0 });
  });
});

// Height-aware packing: the full-LOD (zoomed-in) card is taller than the title-only card, so the
// layout reserves vertical room per card from its estimated height — long-title cards no longer
// overlap the slot below them. A node with no title keeps the fixed rowH slot (covered above).
describe("layoutRoadmap (height-aware vertical spacing)", () => {
  it("reserves more room for a long-title card so the next card stacks below its full height", () => {
    const longTitle = "A very long roadmap feature title that wraps onto several lines";
    const nodes = [
      f("p1", { cluster: "AUTH", title: longTitle }),
      f("p2", { cluster: "AUTH", title: "short" }),
    ];
    const pos = layoutRoadmap(nodes, "cluster", { ...OPTS, maxCols: 1 });
    const est = estimateRoadmapCardHeight({ title: longTitle, role: null }, 0);
    expect(est).toBeGreaterThan(100); // taller than the fixed rowH (100 in OPTS)
    expect(pos.get("p2")!.y).toBe(est); // p2 sits below p1's reserved height, not at the old 100
  });

  it("stacks a sub-task below its parent's estimated height (not the fixed slot)", () => {
    const longTitle = "Parent feature carrying a long multi-line title right here";
    const nodes = [
      f("p", { cluster: "AUTH", title: longTitle }),
      f("k", { parentId: "p", title: "child task" }),
    ];
    const pos = layoutRoadmap(nodes, "cluster", { ...OPTS, maxCols: 1, childIndent: 24 });
    // The parent has a child → its slot also reserves the progress-bar row.
    const parentSlot = estimateRoadmapCardHeight({ title: longTitle, role: null }, 1);
    expect(parentSlot).toBeGreaterThan(100);
    expect(pos.get("k")).toEqual({ x: 24, y: parentSlot });
  });

  it("short-title cards keep the comfortable fixed slot (never tighter than rowH)", () => {
    const nodes = [
      f("a", { cluster: "AUTH", title: "tiny" }),
      f("b", { cluster: "AUTH", title: "tiny" }),
    ];
    const pos = layoutRoadmap(nodes, "cluster", { ...OPTS, maxCols: 1 });
    expect(pos.get("b")!.y).toBe(100); // floored at rowH — short cards aren't packed tighter
  });
});

describe("estimateRoadmapCardHeight", () => {
  it("grows with title line count", () => {
    const short = estimateRoadmapCardHeight({ title: "hi", role: null }, 0);
    const long = estimateRoadmapCardHeight({ title: "x".repeat(120), role: null }, 0);
    expect(long).toBeGreaterThan(short);
  });

  it("adds room for a role sub-line and for the sub-task progress bar", () => {
    const base = estimateRoadmapCardHeight({ title: "feature", role: null }, 0);
    expect(estimateRoadmapCardHeight({ title: "feature", role: "does a thing" }, 0)).toBeGreaterThan(base);
    expect(estimateRoadmapCardHeight({ title: "feature", role: null }, 3)).toBeGreaterThan(base);
  });
});

describe("statusLaneKey (Linear workflow-state lanes)", () => {
  it("falls back to the Beacon status without a state name", () => {
    expect(statusLaneKey({ status: "IN_PROGRESS" })).toBe("IN_PROGRESS");
    expect(statusLaneKey({ status: "PENDING", stateName: null })).toBe("PENDING");
    expect(statusLaneKey({ status: "PENDING", stateName: "  " })).toBe("PENDING");
  });

  it("splits a real workflow state into its own lane", () => {
    expect(statusLaneKey({ status: "IN_PROGRESS", stateName: "In Review" })).toBe("In Review");
    expect(statusLaneKey({ status: "PENDING", stateName: "Backlog" })).toBe("Backlog");
  });

  it("merges a case-variant of the Beacon label into the native lane", () => {
    // Linear "In Progress" ≈ Beacon "In progress" → manual + synced cards group together.
    expect(statusLaneKey({ status: "IN_PROGRESS", stateName: "In Progress" })).toBe("IN_PROGRESS");
    expect(statusLaneKey({ status: "DONE", stateName: "done" })).toBe("DONE");
    expect(statusLaneKey({ status: "PENDING", stateName: " pending " })).toBe("PENDING");
  });
});

describe("layoutRoadmap status lanes with Linear states", () => {
  it("gives 'In Review' its own lane, anchored after IN_PROGRESS and before PENDING", () => {
    const nodes = [
      f("pend", { status: "PENDING" }),
      f("rev", { status: "IN_PROGRESS", stateName: "In Review", stateType: "started" }),
      f("wip", { status: "IN_PROGRESS" }),
    ];
    const pos = layoutRoadmap(nodes, "status", OPTS);
    expect(pos.get("wip")!.x).toBe(0); // IN_PROGRESS lane first
    expect(pos.get("rev")!.x).toBe(350); // In Review — its own lane, still in the "now" zone
    expect(pos.get("pend")!.x).toBe(700); // PENDING after the started-type lanes
  });

  it("anchors unstarted-type states in the PENDING zone and merges case-variants", () => {
    const nodes = [
      f("todo", { status: "PENDING", stateName: "Todo", stateType: "unstarted" }),
      f("wipL", { status: "IN_PROGRESS", stateName: "In Progress", stateType: "started" }),
      f("wip", { status: "IN_PROGRESS" }),
      f("pend", { status: "PENDING" }),
    ];
    const pos = layoutRoadmap(nodes, "status", OPTS);
    // "In Progress" merged into the native lane → same lane block as the manual card.
    expect(pos.get("wipL")!.x).toBe(pos.get("wip")!.x);
    // PENDING lane, then its named unstarted state after it.
    expect(pos.get("pend")!.x).toBeLessThan(pos.get("todo")!.x);
    expect(pos.get("wip")!.x).toBeLessThan(pos.get("pend")!.x);
  });
});
