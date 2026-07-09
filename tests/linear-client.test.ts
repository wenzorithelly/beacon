import { describe, expect, it } from "bun:test";
import { buildIssueFilter, flattenIssue } from "@/lib/linear/client";
import type { LinearScope } from "@/lib/linear/types";

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
      state: { name: "In Review", color: "#0f783c", type: "started" },
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
      state: { name: "Backlog", color: "#888888", type: "backlog" },
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
});
