import { describe, expect, it } from "bun:test";
import { buildIssueFilter, flattenIssue, sortWorkflowStates, stateMapFromStates } from "@/lib/linear/client";
import type { LinearScope, LinearWorkflowState } from "@/lib/linear/types";

describe("flattenIssue", () => {
  it("flattens Linear's nested issue into a LinearIssue (ISO → ms, team id, assignee, state name/color, project/milestone ids)", () => {
    const raw = {
      id: "uuid-1",
      identifier: "V3-339",
      url: "https://linear.app/acme/issue/V3-339/x",
      title: "PWA edit UX",
      description: "scroll",
      updatedAt: "2026-07-06T12:40:00.000Z",
      priority: 2,
      state: { id: "s-review", name: "In Review", color: "#0f783c", type: "started" },
      labels: { nodes: [{ name: "frontend" }, { name: "bug" }] },
      parent: { id: "parent-uuid" },
      team: { id: "team-uuid", key: "V3", name: "Terra Nova" },
      project: { id: "proj-1", name: "Shimizu PWA" },
      projectMilestone: { id: "ms-1", name: "Beta launch" },
      assignee: { id: "u1", name: "Leticia", avatarUrl: "https://a/leticia.png" },
    };
    expect(flattenIssue(raw)).toEqual({
      id: "uuid-1",
      identifier: "V3-339",
      url: "https://linear.app/acme/issue/V3-339/x",
      title: "PWA edit UX",
      description: "scroll",
      updatedAt: Date.parse("2026-07-06T12:40:00.000Z"),
      priority: 2,
      stateId: "s-review",
      stateType: "started",
      stateName: "In Review",
      stateColor: "#0f783c",
      labels: ["frontend", "bug"],
      parentId: "parent-uuid",
      teamId: "team-uuid",
      teamKey: "V3",
      teamName: "Terra Nova",
      projectId: "proj-1",
      projectName: "Shimizu PWA",
      milestoneId: "ms-1",
      milestoneName: "Beta launch",
      assigneeName: "Leticia",
      assigneeAvatarUrl: "https://a/leticia.png",
    });
  });

  it("tolerates absent parent / project / milestone / labels / assignee", () => {
    const f = flattenIssue({
      id: "u",
      identifier: "V3-1",
      url: "u",
      title: "t",
      description: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      priority: 0,
      state: { id: "s-backlog", name: "Backlog", color: "#888888", type: "backlog" },
      labels: { nodes: [] },
      parent: null,
      team: { id: "team-uuid", key: "V3", name: "Terra Nova" },
      project: null,
      projectMilestone: null,
      assignee: null,
    });
    expect(f.parentId).toBeNull();
    expect(f.projectId).toBeNull();
    expect(f.projectName).toBeNull();
    expect(f.milestoneId).toBeNull();
    expect(f.milestoneName).toBeNull();
    expect(f.labels).toEqual([]);
    expect(f.assigneeName).toBeNull();
    expect(f.assigneeAvatarUrl).toBeNull();
  });
});

// Linear's menu groups by type, THEN position. Taken from a real team, where In Review is
// position 1002 but Linear lists it 4th — sorting on position alone put it dead last.
describe("sortWorkflowStates", () => {
  it("matches Linear's own order: by type, then position within the type", () => {
    const real: LinearWorkflowState[] = [
      { id: "1", name: "Backlog", color: "#bec2c8", type: "backlog", position: 0 },
      { id: "2", name: "Todo", color: "#e2e2e2", type: "unstarted", position: 1 },
      { id: "3", name: "In Progress", color: "#f2c94c", type: "started", position: 2 },
      { id: "4", name: "Done", color: "#5e6ad2", type: "completed", position: 3 },
      { id: "5", name: "Canceled", color: "#95a2b3", type: "canceled", position: 4 },
      { id: "6", name: "Duplicate", color: "#95a2b3", type: "duplicate", position: 5 },
      { id: "7", name: "In Review", color: "#0f783c", type: "started", position: 1002 },
    ];
    expect(sortWorkflowStates(real).map((s) => s.name)).toEqual([
      "Backlog",
      "Todo",
      "In Progress",
      "In Review",
      "Done",
      "Canceled",
      "Duplicate",
    ]);
  });

  it("sorts an unknown type last instead of dropping it", () => {
    const states: LinearWorkflowState[] = [
      { id: "x", name: "Weird", color: "#fff", type: "future-linear-type", position: 0 },
      { id: "y", name: "Todo", color: "#eee", type: "unstarted", position: 9 },
    ];
    expect(sortWorkflowStates(states).map((s) => s.name)).toEqual(["Todo", "Weird"]);
  });
});

// The team's REAL workflow states are the workspace's status vocabulary — the picker renders them
// verbatim. This map is only the internal collapse to Beacon's five, used for write-back.
describe("stateMapFromStates", () => {
  const states: LinearWorkflowState[] = [
    { id: "s-backlog", name: "Backlog", color: "#bec2c8", type: "backlog", position: 0 },
    { id: "s-todo", name: "Todo", color: "#e2e2e2", type: "unstarted", position: 1 },
    { id: "s-started", name: "In Progress", color: "#f2c94c", type: "started", position: 2 },
    { id: "s-review", name: "In Review", color: "#0f783c", type: "started", position: 3 },
    { id: "s-done", name: "Done", color: "#5e6ad2", type: "completed", position: 4 },
    { id: "s-cancel", name: "Canceled", color: "#95a2b3", type: "canceled", position: 5 },
  ];

  it("takes the FIRST state of each type, so two started states don't fight", () => {
    expect(stateMapFromStates(states)).toEqual({
      DONE: "s-done",
      CANCELLED: "s-cancel",
      IN_PROGRESS: "s-started",
      BLOCKED: "s-started", // Linear has no blocked type — a blocked task is started-but-stuck
      PENDING: "s-todo", // unstarted wins over backlog
    });
  });

  it("falls back to backlog when the team defines no unstarted state", () => {
    expect(stateMapFromStates(states.filter((s) => s.type !== "unstarted")).PENDING).toBe("s-backlog");
  });

  it("omits what the team doesn't define rather than inventing an id", () => {
    expect(stateMapFromStates([states[0]])).toEqual({ PENDING: "s-backlog" });
  });

  it("uses a Duplicate state as the cancel target when the team defines no canceled one", () => {
    const dupOnly: LinearWorkflowState[] = [
      { id: "s-todo", name: "Todo", color: "#e2e2e2", type: "unstarted", position: 0 },
      { id: "s-dup", name: "Duplicate", color: "#95a2b3", type: "duplicate", position: 1 },
    ];
    expect(stateMapFromStates(dupOnly).CANCELLED).toBe("s-dup");
  });
});

describe("buildIssueFilter", () => {
  const openState = { type: { nin: ["completed", "canceled"] } };

  it("single team scope → an `or` with one `in` branch", () => {
    const scopes: LinearScope[] = [{ kind: "team", id: "t1", name: "V3" }];
    expect(buildIssueFilter(scopes)).toEqual({
      state: openState,
      or: [{ team: { id: { in: ["t1"] } } }],
    });
  });

  it("mixed kinds → one `or` branch per kind present, each with all its ids", () => {
    const scopes: LinearScope[] = [
      { kind: "team", id: "t1", name: "V3" },
      { kind: "team", id: "t2", name: "V4" },
      { kind: "project", id: "p1", name: "Shimizu PWA" },
      { kind: "milestone", id: "m1", name: "Beta", projectName: "Shimizu PWA" },
    ];
    expect(buildIssueFilter(scopes)).toEqual({
      state: openState,
      or: [
        { team: { id: { in: ["t1", "t2"] } } },
        { project: { id: { in: ["p1"] } } },
        { projectMilestone: { id: { in: ["m1"] } } },
      ],
    });
  });

  it("a workspace scope short-circuits to no container constraint, even alongside other scopes", () => {
    const scopes: LinearScope[] = [
      { kind: "workspace", id: "workspace", name: "Acme" },
      { kind: "team", id: "t1", name: "V3" },
    ];
    expect(buildIssueFilter(scopes)).toEqual({ state: openState });
  });

  it("composes the onlyMine assignee filter alongside the scope constraint", () => {
    const scopes: LinearScope[] = [{ kind: "team", id: "t1", name: "V3" }];
    expect(buildIssueFilter(scopes, "viewer-1")).toEqual({
      state: openState,
      assignee: { id: { eq: "viewer-1" } },
      or: [{ team: { id: { in: ["t1"] } } }],
    });
  });

  it("no scopes → no container constraint (skip-guard in sync.ts prevents this in practice)", () => {
    expect(buildIssueFilter([])).toEqual({ state: openState });
  });

  // The closed-issue probe: same scope, no state exclusion, pinned to ids we already track. Both
  // halves matter — dropping `state` is what lets a completed issue come back as Done instead of
  // silently hiding the card, and KEEPING the scope is what still tells "moved out" from "finished".
  describe("with ids (the closed-issue probe)", () => {
    const scopes: LinearScope[] = [{ kind: "team", id: "t1", name: "V3" }];

    it("drops the open-state exclusion and pins the id set, scope intact", () => {
      expect(buildIssueFilter(scopes, undefined, ["ext-A", "ext-B"])).toEqual({
        id: { in: ["ext-A", "ext-B"] },
        or: [{ team: { id: { in: ["t1"] } } }],
      });
    });

    it("still composes onlyMine", () => {
      expect(buildIssueFilter(scopes, "viewer-1", ["ext-A"])).toEqual({
        id: { in: ["ext-A"] },
        assignee: { id: { eq: "viewer-1" } },
        or: [{ team: { id: { in: ["t1"] } } }],
      });
    });
  });
});
