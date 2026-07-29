// Lanes as FIRST-CLASS layout geometry. The roadmap's "Group by" lanes used to be inferred from
// wherever the cards happened to sit (a bounding box), so a card drifting out of its group
// ballooned its lane over the whole board and the lanes visibly overlapped. layoutRoadmapLanes
// exposes the rectangles the layout ITSELF laid out, and computeGroupRegions can draw those
// instead of guessing.
import { describe, expect, it } from "bun:test";
import {
  estimateRoadmapCardHeight,
  layoutRoadmap,
  layoutRoadmapLanes,
  roadmapLaneLabel,
  statusLaneKey,
  type RoadmapGroupBy,
  type RoadmapLayoutNode,
} from "@/lib/roadmap-layout";
import { computeGroupRegions, type RegionInput } from "@/lib/group-regions";

const f = (id: string, over: Partial<RoadmapLayoutNode> = {}): RoadmapLayoutNode => ({
  id,
  parentId: null,
  cluster: null,
  status: "PENDING",
  priority: 2,
  ...over,
});

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function expectNoOverlap(rects: Rect[], what: string) {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      expect(`${what} ${i}×${j}: ${overlaps(rects[i], rects[j])}`).toBe(`${what} ${i}×${j}: false`);
    }
  }
}

// A board with real variety: several themes, several statuses, all four priorities, sub-tasks,
// and a long title (so the height model participates).
const BOARD: RoadmapLayoutNode[] = [
  f("a1", { cluster: "AUTH", status: "IN_PROGRESS", priority: 0, title: "Session refresh" }),
  f("a2", { cluster: "AUTH", status: "PENDING", priority: 1, title: "Password reset flow that wraps a lot" }),
  f("a2k", { parentId: "a2", title: "Send the mail" }),
  f("s1", { cluster: "SEARCH", status: "DONE", priority: 2, title: "Indexing" }),
  f("s2", { cluster: "SEARCH", status: "IN_PROGRESS", priority: 3, title: "Ranking", role: "orders hits" }),
  f("s2k", { parentId: "s2", title: "Tune BM25" }),
  f("d1", { cluster: "DATA", status: "BLOCKED", priority: 0, title: "Migrations" }),
  f("d2", { cluster: "DATA", status: "DONE", priority: 1, title: "Backfill" }),
  f("u1", { cluster: null, status: "CANCELLED", priority: 3, title: "Untethered idea" }),
];
const DIMS: RoadmapGroupBy[] = ["cluster", "status", "priority"];

// Region inputs mirroring what the canvas feeds computeGroupRegions: one per card, grouped by the
// LANE KEY the layout used, positioned wherever the card currently sits.
function regionItems(
  nodes: RoadmapLayoutNode[],
  groupBy: RoadmapGroupBy,
  pos: Map<string, { x: number; y: number }>,
): RegionInput[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const laneOf = (n: RoadmapLayoutNode) => {
    const owner = (n.parentId && byId.get(n.parentId)) || n;
    if (groupBy === "status") return statusLaneKey(owner);
    if (groupBy === "priority") return String(owner.priority);
    return (owner.cluster ?? "").trim() || "—";
  };
  return nodes.map((n) => ({
    id: n.id,
    group: laneOf(n),
    x: pos.get(n.id)!.x,
    y: pos.get(n.id)!.y,
    w: 256,
    h: 96,
  }));
}

describe("layoutRoadmapLanes (lane rectangles)", () => {
  it("returns the same positions layoutRoadmap does, plus one lane per group", () => {
    const { positions, lanes } = layoutRoadmapLanes(BOARD, "cluster");
    expect(positions).toEqual(layoutRoadmap(BOARD, "cluster"));
    expect(lanes.map((l) => l.key)).toEqual(["AUTH", "DATA", "SEARCH", "—"]);
    expect(lanes.map((l) => l.label)).toEqual(["AUTH", "DATA", "SEARCH", "—"]);
  });

  it("lays out lanes that never overlap, for every grouping dimension", () => {
    for (const dim of DIMS) {
      const { lanes } = layoutRoadmapLanes(BOARD, dim);
      expect(lanes.length).toBeGreaterThan(1);
      expectNoOverlap(lanes, `lane[${dim}]`);
    }
  });

  it("puts every card inside its own lane's rectangle", () => {
    for (const dim of DIMS) {
      const { positions, lanes } = layoutRoadmapLanes(BOARD, dim);
      const byKey = new Map(lanes.map((l) => [l.key, l]));
      for (const it of regionItems(BOARD, dim, positions)) {
        const lane = byKey.get(it.group)!;
        expect(lane).toBeDefined();
        expect(it.x).toBeGreaterThanOrEqual(lane.x);
        expect(it.y).toBeGreaterThanOrEqual(lane.y);
        expect(it.x + it.w).toBeLessThanOrEqual(lane.x + lane.w);
        expect(it.y).toBeLessThan(lane.y + lane.h);
      }
    }
  });

  it("sizes a lane from the SAME height model the cards are packed with", () => {
    const long = "A very long roadmap feature title that wraps onto several lines";
    const nodes = [f("p1", { cluster: "AUTH", title: long }), f("p2", { cluster: "AUTH", title: "short" })];
    const { lanes } = layoutRoadmapLanes(nodes, "cluster", { colW: 300, rowH: 100, maxCols: 1 });
    const expected =
      estimateRoadmapCardHeight({ title: long, role: null }, 0) +
      Math.max(100, estimateRoadmapCardHeight({ title: "short", role: null }, 0));
    expect(lanes[0].h).toBe(expected);
    expect(lanes[0].w).toBe(300);
  });

  it("labels status lanes by their status label and priority lanes P0…P3", () => {
    const { lanes } = layoutRoadmapLanes(BOARD, "status");
    expect(lanes.find((l) => l.key === "IN_PROGRESS")!.label).toBe("In progress");
    const prio = layoutRoadmapLanes(BOARD, "priority").lanes;
    expect(prio.map((l) => l.label)).toEqual(["P0", "P1", "P2", "P3"]);
    expect(roadmapLaneLabel("cluster", "AUTH")).toBe("AUTH");
  });

  it("returns no lanes for an empty board", () => {
    expect(layoutRoadmapLanes([], "status").lanes).toEqual([]);
  });
});

describe("computeGroupRegions (from-layout mode)", () => {
  it("derives regions from cards by DEFAULT (unchanged)", () => {
    const items = [
      { id: "a", group: "X", x: 0, y: 0, w: 256, h: 96 },
      { id: "b", group: "X", x: 320, y: 150, w: 256, h: 96 },
    ];
    const [r] = computeGroupRegions(items);
    expect({ x: r.x, y: r.y, w: r.w, h: r.h, count: r.count }).toEqual({
      x: -20,
      y: -46,
      w: 576 + 40,
      h: 246 + 40 + 26,
      count: 2,
    });
  });

  it("takes the lane rectangles when given them, padded like a card-derived region", () => {
    const { positions, lanes } = layoutRoadmapLanes(BOARD, "cluster");
    const regions = computeGroupRegions(regionItems(BOARD, "cluster", positions), { lanes });
    expect(regions.map((r) => r.key)).toEqual(lanes.map((l) => l.key));
    const auth = regions.find((r) => r.key === "AUTH")!;
    const laneAuth = lanes.find((l) => l.key === "AUTH")!;
    expect(auth.x).toBe(laneAuth.x - 20);
    expect(auth.y).toBe(laneAuth.y - 20 - 26);
    expect(auth.w).toBe(laneAuth.w + 40);
    expect(auth.h).toBe(laneAuth.h + 40 + 26);
    expect(auth.count).toBe(3); // a1, a2, a2k
  });

  it("keeps every region stable and non-overlapping when cards drift out of their lane", () => {
    for (const dim of DIMS) {
      const { positions, lanes } = layoutRoadmapLanes(BOARD, dim);
      const settled = regionItems(BOARD, dim, positions);
      const before = computeGroupRegions(settled, { lanes });
      // The user drags cards all over the board (the real-world drift).
      const drifted = settled.map((it, i) => ({ ...it, x: it.x + i * 900, y: it.y - i * 700 }));
      const after = computeGroupRegions(drifted, { lanes });
      expect(after).toEqual(before);
      expectNoOverlap(after, `region[${dim}]`);
      // Contrast: the derive-from-cards default balloons and overlaps once cards drift.
      const inferred = computeGroupRegions(drifted);
      expect(inferred).not.toEqual(before);
    }
  });

  it("keeps an emptied lane's rectangle, with count 0", () => {
    const { positions, lanes } = layoutRoadmapLanes(BOARD, "cluster");
    const items = regionItems(BOARD, "cluster", positions).filter((it) => it.group !== "SEARCH");
    const regions = computeGroupRegions(items, { lanes });
    expect(regions).toHaveLength(lanes.length);
    expect(regions.find((r) => r.key === "SEARCH")!.count).toBe(0);
  });

  it("draws nothing for a card whose group has no lane (it must not balloon a box)", () => {
    const lanes = [{ key: "A", label: "A", x: 0, y: 0, w: 300, h: 200 }];
    const regions = computeGroupRegions(
      [
        { id: "a", group: "A", x: 0, y: 0, w: 256, h: 96 },
        { id: "z", group: "RETHEMED", x: 9000, y: 9000, w: 256, h: 96 },
      ],
      { lanes },
    );
    expect(regions.map((r) => r.key)).toEqual(["A"]);
    expect(regions[0].count).toBe(1);
  });

  it("returns [] when the board has no lanes at all", () => {
    expect(computeGroupRegions([{ id: "a", group: "A", x: 0, y: 0, w: 1, h: 1 }], { lanes: [] })).toEqual([]);
  });
});

describe("statusLaneKey (unambiguous workflow-state lanes)", () => {
  it("keeps two same-named states on different teams in their own lanes", () => {
    const eng = { status: "DONE", stateName: "Done", teamKey: "ENG" };
    const des = { status: "DONE", stateName: "Done", teamKey: "DES" };
    expect(statusLaneKey(eng)).not.toBe(statusLaneKey(des));
    // …and neither is confused with the native Beacon lane.
    expect(statusLaneKey(eng)).not.toBe("DONE");
    expect(statusLaneKey({ status: "DONE" })).toBe("DONE");
  });

  it("gives each team's lane its own block on the board", () => {
    const nodes = [
      f("e", { status: "DONE", stateName: "Done", stateType: "completed", teamKey: "ENG" }),
      f("d", { status: "DONE", stateName: "Done", stateType: "completed", teamKey: "DES" }),
      f("n", { status: "DONE" }),
    ];
    const { lanes } = layoutRoadmapLanes(nodes, "status", { colW: 300, laneGap: 50, minBandW: 100000 });
    expect(lanes).toHaveLength(3);
    expectNoOverlap(lanes, "team lane");
    expect(new Set(lanes.map((l) => l.label)).size).toBe(3);
  });

  it("without a team identity, behaves exactly as before", () => {
    expect(statusLaneKey({ status: "IN_PROGRESS", stateName: "In Progress" })).toBe("IN_PROGRESS");
    expect(statusLaneKey({ status: "IN_PROGRESS", stateName: "In Review" })).toBe("In Review");
    expect(statusLaneKey({ status: "PENDING", stateName: "  " })).toBe("PENDING");
  });
});
