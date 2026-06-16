import { describe, expect, it } from "bun:test";
import {
  SHARE_SNAPSHOT_VERSION,
  shareSnapshotSchema,
  snapshotSummary,
  type BoardsSnapshot,
  type PlanShareSnapshot,
} from "@/lib/share-snapshot";

function boardsSnapshot(): BoardsSnapshot {
  return {
    kind: "boards",
    version: SHARE_SNAPSHOT_VERSION,
    createdAt: 1_700_000_000_000,
    workspaceLabel: "beacon",
    selectedTabs: ["ROADMAP", "DATABASE"],
    roadmap: {
      hasFrontend: true,
      edges: [],
      nodes: [
        {
          id: "n1",
          view: "ROADMAP",
          kind: "FEATURE",
          cluster: "LAUNCH",
          layer: "fullstack",
          title: "Shareable link",
          role: null,
          plain: null,
          status: "PENDING",
          priority: 1,
          x: 120,
          y: 40,
          source: "MANUAL",
          sourceRef: null,
          parentId: null,
          isCriterion: false,
          files: [],
          bugFlags: [],
        },
      ],
    },
    database: {
      tables: [
        {
          id: "t1",
          name: "SharedBoard",
          domain: "LAUNCH",
          description: null,
          source: "MANUAL",
          x: 0,
          y: 0,
          columns: [
            { name: "token", type: "text", isPk: true, isFk: false, nullable: false, note: null },
          ],
        },
      ],
      relations: [],
      endpoints: [],
      draft: null,
    },
  };
}

function planSnapshot(): PlanShareSnapshot {
  return {
    kind: "plan",
    version: SHARE_SNAPSHOT_VERSION,
    createdAt: 1_700_000_000_000,
    workspaceLabel: "beacon",
    title: "Shareable link",
    markdown: "# Shareable link\n\nbody",
    verdict: "approved",
  };
}

describe("shareSnapshotSchema", () => {
  it("accepts a valid boards snapshot and preserves positions", () => {
    const parsed = shareSnapshotSchema.parse(boardsSnapshot());
    expect(parsed.kind).toBe("boards");
    if (parsed.kind !== "boards") throw new Error("unreachable");
    expect(parsed.roadmap!.nodes[0].x).toBe(120);
    expect(parsed.database!.tables[0].columns[0].isPk).toBe(true);
  });

  it("accepts a valid plan snapshot", () => {
    const parsed = shareSnapshotSchema.parse(planSnapshot());
    expect(parsed.kind).toBe("plan");
  });

  it("rejects an incompatible version", () => {
    expect(shareSnapshotSchema.safeParse({ ...boardsSnapshot(), version: 999 }).success).toBe(false);
  });

  it("rejects an unknown kind or a missing kind", () => {
    expect(shareSnapshotSchema.safeParse({ ...boardsSnapshot(), kind: "files" }).success).toBe(false);
    const { kind, ...noKind } = boardsSnapshot();
    void kind;
    expect(shareSnapshotSchema.safeParse(noKind).success).toBe(false);
  });

  it("rejects an empty selectedTabs and an unknown tab name", () => {
    expect(shareSnapshotSchema.safeParse({ ...boardsSnapshot(), selectedTabs: [] }).success).toBe(false);
    expect(shareSnapshotSchema.safeParse({ ...boardsSnapshot(), selectedTabs: ["PLAN"] }).success).toBe(false);
  });

  it("rejects a roadmap node missing its position", () => {
    const snap = boardsSnapshot();
    const { y, ...nodeNoY } = snap.roadmap!.nodes[0];
    void y;
    const bad = { ...snap, roadmap: { ...snap.roadmap!, nodes: [nodeNoY] } };
    expect(shareSnapshotSchema.safeParse(bad).success).toBe(false);
  });
});

describe("snapshotSummary", () => {
  it("joins board tabs and labels a plan", () => {
    expect(snapshotSummary(boardsSnapshot())).toBe("ROADMAP,DATABASE");
    expect(snapshotSummary(planSnapshot())).toBe("PLAN");
  });
});
