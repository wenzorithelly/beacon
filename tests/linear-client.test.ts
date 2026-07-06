import { describe, expect, it } from "bun:test";
import { flattenIssue } from "@/lib/linear/client";

describe("flattenIssue", () => {
  it("flattens Linear's nested issue into a LinearIssue (ISO → ms)", () => {
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
      team: { key: "V3" },
      project: { name: "Shimizu PWA" },
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
      teamKey: "V3",
      projectName: "Shimizu PWA",
    });
  });

  it("tolerates absent parent / project / labels", () => {
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
      team: { key: "V3" },
      project: null,
    });
    expect(f.parentId).toBeNull();
    expect(f.projectName).toBeNull();
    expect(f.labels).toEqual([]);
  });
});
