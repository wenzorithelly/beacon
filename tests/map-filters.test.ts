import { describe, expect, it } from "bun:test";
import { EMPTY_ROADMAP_FILTERS, nodePassesFilters, type FilterableNode } from "@/lib/map-filters";

const beaconNode: FilterableNode = {
  status: "IN_PROGRESS",
  cluster: "Billing",
  priority: 1,
  source: "MANUAL",
  externalMeta: null,
};

const linearNode: FilterableNode = {
  status: "IN_PROGRESS",
  cluster: "Shimizu PWA",
  priority: 0,
  source: "LINEAR",
  externalMeta: {
    state: { name: "In Review", color: "#0f783c", type: "started" },
    team: { id: "team-1", key: "V3", name: "Terra Nova" },
    project: { id: "proj-1", name: "Shimizu PWA" },
    milestone: { id: "ms-1", name: "Beta launch" },
  },
};

const linearNodeNoProjectOrMilestone: FilterableNode = {
  status: "PENDING",
  cluster: "V3",
  priority: 2,
  source: "LINEAR",
  externalMeta: {
    state: { name: "Todo", color: "#e2e2e2", type: "unstarted" },
    team: { id: "team-1", key: "V3", name: "Terra Nova" },
  },
};

describe("nodePassesFilters — Beacon-native dimensions (unchanged behavior)", () => {
  it("passes everything when no filter is active", () => {
    expect(nodePassesFilters(beaconNode, EMPTY_ROADMAP_FILTERS)).toBe(true);
    expect(nodePassesFilters(linearNode, EMPTY_ROADMAP_FILTERS)).toBe(true);
  });

  it("filters by status", () => {
    const f = { ...EMPTY_ROADMAP_FILTERS, status: new Set(["DONE"]) };
    expect(nodePassesFilters(beaconNode, f)).toBe(false);
    expect(nodePassesFilters({ ...beaconNode, status: "DONE" }, f)).toBe(true);
  });

  it("filters by cluster, dropping nodes with no cluster", () => {
    const f = { ...EMPTY_ROADMAP_FILTERS, cluster: new Set(["Billing"]) };
    expect(nodePassesFilters(beaconNode, f)).toBe(true);
    expect(nodePassesFilters({ ...beaconNode, cluster: null }, f)).toBe(false);
  });

  it("filters by priority", () => {
    const f = { ...EMPTY_ROADMAP_FILTERS, priority: new Set([0]) };
    expect(nodePassesFilters(beaconNode, f)).toBe(false);
    expect(nodePassesFilters(linearNode, f)).toBe(true);
  });
});

describe("nodePassesFilters — Linear dimensions", () => {
  it("filtering by team hides a non-Linear card", () => {
    const f = { ...EMPTY_ROADMAP_FILTERS, team: new Set(["Terra Nova"]) };
    expect(nodePassesFilters(beaconNode, f)).toBe(false);
    expect(nodePassesFilters(linearNode, f)).toBe(true);
  });

  it("filtering by team excludes a Linear card from a different team", () => {
    const f = { ...EMPTY_ROADMAP_FILTERS, team: new Set(["Someone Else's Team"]) };
    expect(nodePassesFilters(linearNode, f)).toBe(false);
  });

  it("filtering by project hides a Linear card with no project", () => {
    const f = { ...EMPTY_ROADMAP_FILTERS, project: new Set(["Shimizu PWA"]) };
    expect(nodePassesFilters(linearNode, f)).toBe(true);
    expect(nodePassesFilters(linearNodeNoProjectOrMilestone, f)).toBe(false);
  });

  it("filtering by milestone hides a Linear card with no milestone", () => {
    const f = { ...EMPTY_ROADMAP_FILTERS, milestone: new Set(["Beta launch"]) };
    expect(nodePassesFilters(linearNode, f)).toBe(true);
    expect(nodePassesFilters(linearNodeNoProjectOrMilestone, f)).toBe(false);
  });

  it("filtering by state matches the Linear state name", () => {
    const f = { ...EMPTY_ROADMAP_FILTERS, state: new Set(["In Review"]) };
    expect(nodePassesFilters(linearNode, f)).toBe(true);
    expect(nodePassesFilters(linearNodeNoProjectOrMilestone, f)).toBe(false);
  });

  it("combines multiple Linear dimensions (AND semantics)", () => {
    const f = {
      ...EMPTY_ROADMAP_FILTERS,
      team: new Set(["Terra Nova"]),
      state: new Set(["Todo"]),
    };
    expect(nodePassesFilters(linearNode, f)).toBe(false); // team matches, state doesn't
    expect(nodePassesFilters(linearNodeNoProjectOrMilestone, f)).toBe(true);
  });

  it("combines a Beacon-native dimension with a Linear dimension", () => {
    const f = { ...EMPTY_ROADMAP_FILTERS, priority: new Set([0]), team: new Set(["Terra Nova"]) };
    expect(nodePassesFilters(linearNode, f)).toBe(true);
    expect(nodePassesFilters(linearNodeNoProjectOrMilestone, f)).toBe(false); // priority 2, not 0
  });
});
