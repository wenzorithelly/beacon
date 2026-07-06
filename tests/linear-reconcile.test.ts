import { describe, expect, it } from "bun:test";
import { planReconcile, type LocalNode } from "@/lib/linear/reconcile";
import type { LinearIssue } from "@/lib/linear/types";

const issue = (over: Partial<LinearIssue> = {}): LinearIssue => ({
  id: "ext-1",
  identifier: "V3-1",
  url: "https://linear.app/acme/issue/V3-1",
  title: "T",
  description: null,
  updatedAt: 1_000,
  priority: 0,
  stateType: "started",
  labels: [],
  parentId: null,
  teamKey: "V3",
  projectName: null,
  ...over,
});

const local = (over: Partial<LocalNode> = {}): LocalNode => ({
  id: "node-1",
  externalId: "ext-1",
  updatedAt: 100,
  externalUpdatedAt: 100,
  externalSyncedAt: 100,
  title: "T",
  plain: null,
  status: "IN_PROGRESS",
  priority: 2,
  ...over,
});

describe("planReconcile", () => {
  it("creates a node for a Linear issue with no local match", () => {
    const plan = planReconcile([], [issue()]);
    expect(plan).toEqual([{ action: "create", issue: issue() }]);
  });

  it("pulls when Linear changed and Beacon did not", () => {
    const n = local({ externalUpdatedAt: 100, updatedAt: 100, externalSyncedAt: 100 });
    const i = issue({ updatedAt: 200 });
    expect(planReconcile([n], [i])).toEqual([{ action: "pull", node: n, issue: i }]);
  });

  it("pushes a local-only edit not present in the delta", () => {
    const n = local({ updatedAt: 300, externalSyncedAt: 100 });
    expect(planReconcile([n], [])).toEqual([{ action: "push", node: n, issue: null }]);
  });

  it("LWW: both changed, Linear newer wins → pull", () => {
    const n = local({ externalUpdatedAt: 100, externalSyncedAt: 100, updatedAt: 250 });
    const i = issue({ updatedAt: 300 });
    expect(planReconcile([n], [i])).toEqual([{ action: "pull", node: n, issue: i }]);
  });

  it("LWW: both changed, Beacon newer wins → push", () => {
    const n = local({ externalUpdatedAt: 100, externalSyncedAt: 100, updatedAt: 250 });
    const i = issue({ updatedAt: 200 });
    expect(planReconcile([n], [i])).toEqual([{ action: "push", node: n, issue: i }]);
  });

  it("noop (echo suppression): issue reappears in delta but nothing changed since last sync", () => {
    const n = local({ externalUpdatedAt: 300, externalSyncedAt: 300, updatedAt: 300 });
    const i = issue({ updatedAt: 300 });
    expect(planReconcile([n], [i])).toEqual([{ action: "noop", node: n }]);
  });

  it("omits local-only nodes that have not changed since last sync", () => {
    const n = local({ updatedAt: 100, externalSyncedAt: 100 });
    expect(planReconcile([n], [])).toEqual([]);
  });

  it("handles a mix in one pass", () => {
    const fresh = issue({ id: "new", updatedAt: 500 });
    const pulling = local({ id: "p", externalId: "pe", externalUpdatedAt: 1, updatedAt: 1, externalSyncedAt: 1 });
    const pullIssue = issue({ id: "pe", updatedAt: 9 });
    const pushingLocalOnly = local({ id: "q", externalId: "qe", updatedAt: 900, externalSyncedAt: 1 });
    const plan = planReconcile([pulling, pushingLocalOnly], [fresh, pullIssue]);
    expect(plan).toContainEqual({ action: "create", issue: fresh });
    expect(plan).toContainEqual({ action: "pull", node: pulling, issue: pullIssue });
    expect(plan).toContainEqual({ action: "push", node: pushingLocalOnly, issue: null });
    expect(plan).toHaveLength(3);
  });
});
