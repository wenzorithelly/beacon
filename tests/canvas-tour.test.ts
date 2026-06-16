import { describe, expect, it } from "bun:test";
import { buildArchTour, buildFileTour, type TourStep } from "@/lib/canvas-tour";

// Deterministic, dependency-ordered tour over the FILES import graph. Pure function of the
// graph the browser already holds — entry points first, then group steps in topological order
// (importers before the leaves they depend on). Cycles (precomputed `circular` flag) are
// dropped from the ordering. Same input → same steps.

type F = { path: string; inDegree?: number; outDegree?: number };
type E = { from: string; to: string; circular?: boolean };

// A small 3-area chain: A (entry) imports B imports C (leaf utility).
const files: F[] = [
  { path: "a/main.ts", inDegree: 0, outDegree: 1 },
  { path: "b/service.ts", inDegree: 1, outDegree: 1 },
  { path: "c/util.ts", inDegree: 1, outDegree: 0 },
];
const edges: E[] = [
  { from: "a/main.ts", to: "b/service.ts", circular: false },
  { from: "b/service.ts", to: "c/util.ts", circular: false },
];
const groupKeys = new Map([
  ["a/main.ts", "a"],
  ["b/service.ts", "b"],
  ["c/util.ts", "c"],
]);

const groupTitles = (steps: TourStep[]) => steps.filter((s) => s.kind === "group").map((s) => s.title);

describe("buildFileTour", () => {
  it("returns nothing for an empty graph", () => {
    expect(buildFileTour([], [], new Map())).toEqual([]);
  });

  it("always opens with an overview step that frames the whole board", () => {
    const steps = buildFileTour(files, edges, groupKeys);
    expect(steps[0].kind).toBe("overview");
    expect(steps[0].focusIds).toEqual([]);
  });

  it("emits an entry-points step listing files nothing imports", () => {
    const entry = buildFileTour(files, edges, groupKeys).find((s) => s.kind === "entry");
    expect(entry).toBeDefined();
    expect(entry!.focusIds).toEqual(["a/main.ts"]);
  });

  it("omits the entry-points step when every file is imported by something", () => {
    // a fully cyclic pair: each imports the other → both inDegree 1, no entry point.
    const cyc: F[] = [
      { path: "x/one.ts", inDegree: 1 },
      { path: "x/two.ts", inDegree: 1 },
    ];
    const steps = buildFileTour(cyc, [], new Map([["x/one.ts", "x"], ["x/two.ts", "x"]]));
    expect(steps.some((s) => s.kind === "entry")).toBe(false);
  });

  it("orders group steps entry-points-first (A imports B imports C → A, B, C)", () => {
    expect(groupTitles(buildFileTour(files, edges, groupKeys))).toEqual(["a", "b", "c"]);
  });

  it("excludes circular edges from the dependency ordering", () => {
    // Add a circular back-edge c → a. It must NOT reorder the tour.
    const withCycle: E[] = [...edges, { from: "c/util.ts", to: "a/main.ts", circular: true }];
    expect(groupTitles(buildFileTour(files, withCycle, groupKeys))).toEqual(["a", "b", "c"]);
  });

  it("breaks ties between entry groups by cluster size desc, then name", () => {
    // Two independent entry groups: 'big' (2 files) and 'small' (1 file), no edges between.
    const f: F[] = [
      { path: "small/s.ts", inDegree: 0 },
      { path: "big/a.ts", inDegree: 0 },
      { path: "big/b.ts", inDegree: 0 },
    ];
    const gk = new Map([
      ["small/s.ts", "small"],
      ["big/a.ts", "big"],
      ["big/b.ts", "big"],
    ]);
    expect(groupTitles(buildFileTour(f, [], gk))).toEqual(["big", "small"]);
  });

  it("picks the top hub (highest inDegree) into each group step's summary", () => {
    const f: F[] = [
      { path: "lib/hub.ts", inDegree: 9 },
      { path: "lib/minor.ts", inDegree: 1 },
    ];
    const gk = new Map([["lib/hub.ts", "lib"], ["lib/minor.ts", "lib"]]);
    const grp = buildFileTour(f, [], gk).find((s) => s.kind === "group")!;
    expect(grp.summary).toContain("hub.ts");
    expect(grp.focusIds).toEqual(["lib/hub.ts", "lib/minor.ts"]);
  });

  it("disambiguates colliding hub basenames by parent dir", () => {
    // Two different `keys.ts` files are the group's hubs — must not render "keys.ts, keys.ts".
    const f: F[] = [
      { path: "lib/auth/keys.ts", inDegree: 9 },
      { path: "lib/api/keys.ts", inDegree: 8 },
    ];
    const gk = new Map([["lib/auth/keys.ts", "lib"], ["lib/api/keys.ts", "lib"]]);
    const grp = buildFileTour(f, [], gk).find((s) => s.kind === "group")!;
    expect(grp.summary).toContain("auth/keys.ts");
    expect(grp.summary).toContain("api/keys.ts");
    expect(grp.summary).not.toContain("keys.ts, keys.ts");
  });

  it("is fully deterministic — identical input yields identical steps", () => {
    expect(buildFileTour(files, edges, groupKeys)).toEqual(buildFileTour(files, edges, groupKeys));
  });

  it("handles a single-group repo (overview + entry + one group)", () => {
    const f: F[] = [{ path: "only/x.ts", inDegree: 0 }];
    const steps = buildFileTour(f, [], new Map([["only/x.ts", "only"]]));
    expect(steps.map((s) => s.kind)).toEqual(["overview", "entry", "group"]);
  });
});

describe("buildArchTour", () => {
  type A = { id: string; cluster?: string | null; title?: string | null; x?: number };

  it("returns nothing for an empty architecture map", () => {
    expect(buildArchTour([])).toEqual([]);
  });

  it("opens with an architecture overview, then one step per domain", () => {
    const nodes: A[] = [
      { id: "n1", cluster: "INTEL", title: "Code graph", x: 0 },
      { id: "n2", cluster: "UI", title: "Roadmap canvas", x: 100 },
    ];
    const steps = buildArchTour(nodes);
    expect(steps[0].kind).toBe("overview");
    expect(steps.filter((s) => s.kind === "group").map((s) => s.title)).toEqual(["INTEL", "UI"]);
  });

  it("orders domains by leftmost x (dependency-flow), then name", () => {
    // UI sits left (x=10) of INTEL (x=200) → UI first despite alphabetical order.
    const nodes: A[] = [
      { id: "a", cluster: "INTEL", x: 200 },
      { id: "b", cluster: "UI", x: 10 },
    ];
    expect(buildArchTour(nodes).filter((s) => s.kind === "group").map((s) => s.title)).toEqual([
      "UI",
      "INTEL",
    ]);
  });

  it("frames every component in a domain step", () => {
    const nodes: A[] = [
      { id: "a", cluster: "INTEL", x: 0 },
      { id: "b", cluster: "INTEL", x: 50 },
    ];
    const step = buildArchTour(nodes).find((s) => s.kind === "group")!;
    expect(step.focusIds.sort()).toEqual(["a", "b"]);
  });
});
