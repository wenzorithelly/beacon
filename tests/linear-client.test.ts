import { describe, expect, it } from "bun:test";
import { flattenIssue } from "@/lib/linear/client";

describe("flattenIssue", () => {
  it("flattens Linear's nested issue into a LinearIssue (ISO → ms, team id, assignee)", () => {
    const raw = {
      id: "uuid-1",
      identifier: "V3-339",
      url: "https://linear.app/acme/issue/V3-339/x",
      title: "PWA edit UX",
      description: "scroll",
      updatedAt: "2026-07-06T12:40:00.000Z",
      priority: 2,
      state: { type: "started" },
      labels: { nodes: [{ name: "frontend" }, { name: "bug" }] },
      parent: { id: "parent-uuid" },
      team: { id: "team-uuid", key: "V3" },
      project: { name: "Shimizu PWA" },
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
      labels: ["frontend", "bug"],
      parentId: "parent-uuid",
      teamId: "team-uuid",
      teamKey: "V3",
      projectName: "Shimizu PWA",
      assigneeName: "Leticia",
      assigneeAvatarUrl: "https://a/leticia.png",
    });
  });

  it("tolerates absent parent / project / labels / assignee", () => {
    const f = flattenIssue({
      id: "u",
      identifier: "V3-1",
      url: "u",
      title: "t",
      description: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      priority: 0,
      state: { type: "backlog" },
      labels: { nodes: [] },
      parent: null,
      team: { id: "team-uuid", key: "V3" },
      project: null,
      assignee: null,
    });
    expect(f.parentId).toBeNull();
    expect(f.projectName).toBeNull();
    expect(f.labels).toEqual([]);
    expect(f.assigneeName).toBeNull();
    expect(f.assigneeAvatarUrl).toBeNull();
  });
});
