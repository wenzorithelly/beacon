import { describe, expect, it } from "bun:test";
import {
  beaconPriorityToLinear,
  issueToNodeFields,
  linearPriorityToBeacon,
  linearStateToStatus,
} from "@/lib/linear/mapping";
import type { LinearIssue } from "@/lib/linear/types";

const issue = (over: Partial<LinearIssue> = {}): LinearIssue => ({
  id: "uuid-1",
  identifier: "V3-339",
  url: "https://linear.app/acme/issue/V3-339/pwa-edit",
  title: "PWA edit UX",
  description: "Long order is a giant scroll.",
  updatedAt: 1_000,
  priority: 2,
  stateType: "started",
  labels: [],
  parentId: null,
  teamId: "team-1",
  teamKey: "V3",
  projectName: null,
  assigneeName: "Leticia",
  assigneeAvatarUrl: "https://avatars.linear.app/leticia.png",
  ...over,
});

describe("linearStateToStatus", () => {
  it("maps Linear state types to Beacon statuses", () => {
    expect(linearStateToStatus("completed")).toBe("DONE");
    expect(linearStateToStatus("canceled")).toBe("CANCELLED");
    expect(linearStateToStatus("started")).toBe("IN_PROGRESS");
    expect(linearStateToStatus("backlog")).toBe("PENDING");
    expect(linearStateToStatus("unstarted")).toBe("PENDING");
    expect(linearStateToStatus("triage")).toBe("PENDING");
  });
  it("falls back to PENDING for unknown state types", () => {
    expect(linearStateToStatus("weird")).toBe("PENDING");
  });
});

describe("priority mapping (Linear 0-4 ↔ Beacon 0-3)", () => {
  it("maps Linear → Beacon", () => {
    expect(linearPriorityToBeacon(1)).toBe(0); // Urgent → P0
    expect(linearPriorityToBeacon(2)).toBe(1); // High → P1
    expect(linearPriorityToBeacon(3)).toBe(2); // Medium → P2
    expect(linearPriorityToBeacon(4)).toBe(3); // Low → P3
    expect(linearPriorityToBeacon(0)).toBe(2); // None → P2 default
  });
  it("maps Beacon → Linear (write-back is the inverse)", () => {
    expect(beaconPriorityToLinear(0)).toBe(1);
    expect(beaconPriorityToLinear(1)).toBe(2);
    expect(beaconPriorityToLinear(2)).toBe(3);
    expect(beaconPriorityToLinear(3)).toBe(4);
  });
});

describe("issueToNodeFields", () => {
  it("projects a Linear issue onto Beacon node fields", () => {
    const f = issueToNodeFields(issue({ stateType: "completed", priority: 1 }));
    expect(f).toMatchObject({
      title: "PWA edit UX",
      plain: "Long order is a giant scroll.",
      status: "DONE",
      priority: 0,
      kind: "FEATURE",
      source: "LINEAR",
      externalId: "uuid-1",
      sourceRef: "https://linear.app/acme/issue/V3-339/pwa-edit",
      assigneeName: "Leticia",
      assigneeAvatarUrl: "https://avatars.linear.app/leticia.png",
    });
    expect(f).not.toHaveProperty("layer"); // layer is decided by the executor, not the mapper
  });

  it("tolerates an unassigned issue (no owner)", () => {
    const f = issueToNodeFields(issue({ assigneeName: null, assigneeAvatarUrl: null }));
    expect(f.assigneeName).toBeNull();
    expect(f.assigneeAvatarUrl).toBeNull();
  });

  it("uses the project name as category, else the team key", () => {
    expect(issueToNodeFields(issue({ projectName: "Shimizu PWA" })).cluster).toBe("Shimizu PWA");
    expect(issueToNodeFields(issue({ projectName: null })).cluster).toBe("V3");
  });

  it("flags a bug-labeled issue as kind BUG (case-insensitive)", () => {
    expect(issueToNodeFields(issue({ labels: ["Bug"] })).kind).toBe("BUG");
    expect(issueToNodeFields(issue({ labels: ["frontend", "bug"] })).kind).toBe("BUG");
    expect(issueToNodeFields(issue({ labels: ["frontend"] })).kind).toBe("FEATURE");
  });

  it("tolerates a missing description", () => {
    expect(issueToNodeFields(issue({ description: null })).plain).toBeNull();
  });
});
