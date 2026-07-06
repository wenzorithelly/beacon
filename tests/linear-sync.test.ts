import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { setLinearFlag } from "@/lib/linear/config";
import { runSync, type SyncClient } from "@/lib/linear/sync";
import type { IssuePatch } from "@/lib/linear/client";
import type { LinearIssue } from "@/lib/linear/types";
import { resetDb } from "./helpers";

beforeEach(resetDb);

const issueA: LinearIssue = {
  id: "ext-A",
  identifier: "V3-1",
  url: "https://linear.app/acme/issue/V3-1",
  title: "First",
  description: "d",
  updatedAt: 500,
  priority: 1,
  stateType: "started",
  labels: [],
  parentId: null,
  teamKey: "V3",
  projectName: null,
};

function fakeClient(over: Partial<SyncClient> = {}): SyncClient & { updates: { id: string; patch: IssuePatch }[] } {
  const updates: { id: string; patch: IssuePatch }[] = [];
  return {
    updates,
    resolveStateMap: async () => ({ IN_PROGRESS: "s-started", DONE: "s-done" }),
    fetchIssuesSince: async () => [],
    updateIssue: async (_key, id, patch) => {
      updates.push({ id, patch });
      return 6_000;
    },
    ...over,
  };
}

async function connect() {
  await setLinearFlag({
    enabled: true,
    config: { apiKey: "lin_k", teamId: "team-1", stateMap: { IN_PROGRESS: "s-started", DONE: "s-done" } },
  });
}

describe("runSync", () => {
  it("skips when disabled", async () => {
    const s = await runSync({ client: fakeClient(), now: 1_000 });
    expect(s.skipped).toBeTruthy();
  });

  it("creates a Beacon card for a new Linear issue and stamps the LWW markers", async () => {
    await connect();
    const s = await runSync({ client: fakeClient({ fetchIssuesSince: async () => [issueA] }), now: 1_000 });
    expect(s.created).toBe(1);
    const [n] = await db.select().from(node).where(eq(node.externalId, "ext-A"));
    expect(n.source).toBe("LINEAR");
    expect(n.title).toBe("First");
    expect(n.status).toBe("IN_PROGRESS");
    expect(n.priority).toBe(0); // Linear Urgent → P0
    expect(n.externalUpdatedAt?.getTime()).toBe(500);
    expect(n.externalSyncedAt?.getTime()).toBe(1_000);
  });

  it("does not duplicate or re-touch an unchanged issue on the next tick (echo suppression)", async () => {
    await connect();
    const client = fakeClient({ fetchIssuesSince: async () => [issueA] });
    await runSync({ client, now: 1_000 });
    const again = await runSync({ client, now: 2_000 });
    expect(again.created).toBe(0);
    expect(again.pulled).toBe(0);
    expect(again.pushed).toBe(0);
    expect(await db.$count(node, eq(node.externalId, "ext-A"))).toBe(1);
  });

  it("pushes a locally-edited card back to Linear", async () => {
    await connect();
    await db.insert(node).values({
      view: "ROADMAP",
      title: "edited locally",
      status: "DONE",
      priority: 2,
      source: "LINEAR",
      externalId: "ext-B",
      sourceRef: "https://linear.app/acme/issue/V3-2",
      updatedAt: new Date(5_000),
      externalUpdatedAt: new Date(1_000),
      externalSyncedAt: new Date(1_000),
    });
    const client = fakeClient({ fetchIssuesSince: async () => [] });
    const s = await runSync({ client, now: 6_000 });
    expect(s.pushed).toBe(1);
    expect(client.updates).toHaveLength(1);
    expect(client.updates[0]).toMatchObject({ id: "ext-B", patch: { title: "edited locally", stateId: "s-done" } });
    const [n] = await db.select().from(node).where(eq(node.externalId, "ext-B"));
    expect(n.externalUpdatedAt?.getTime()).toBe(6_000); // marker advanced to the push response
    expect(n.externalSyncedAt?.getTime()).toBe(6_000);
  });

  it("pushes ONLY the fields changed vs the snapshot — never clobbers priority (No-priority bug)", async () => {
    await connect();
    // Snapshot says priority 2 / plain "d" / IN_PROGRESS; only the title diverges locally.
    await db.insert(node).values({
      view: "ROADMAP",
      title: "renamed in beacon",
      plain: "d",
      status: "IN_PROGRESS",
      priority: 2,
      source: "LINEAR",
      externalId: "ext-C",
      sourceRef: "https://linear.app/acme/issue/V3-3",
      updatedAt: new Date(5_000),
      externalUpdatedAt: new Date(1_000),
      externalSyncedAt: new Date(1_000),
      externalSnapshot: JSON.stringify({ title: "orig", plain: "d", status: "IN_PROGRESS", priority: 2 }),
    });
    const client = fakeClient({ fetchIssuesSince: async () => [] });
    await runSync({ client, now: 6_000, force: true });
    expect(client.updates).toHaveLength(1);
    expect(client.updates[0].patch).toEqual({ title: "renamed in beacon" }); // no priority, no description, no stateId
  });

  it("does not call Linear when a bumped updatedAt reflects no synced-field change (e.g. a canvas drag)", async () => {
    await connect();
    await db.insert(node).values({
      view: "ROADMAP",
      title: "same",
      plain: "same",
      status: "DONE",
      priority: 1,
      source: "LINEAR",
      externalId: "ext-D",
      sourceRef: "https://linear.app/acme/issue/V3-4",
      updatedAt: new Date(9_000), // bumped (drag) but fields match the snapshot
      externalUpdatedAt: new Date(1_000),
      externalSyncedAt: new Date(1_000),
      externalSnapshot: JSON.stringify({ title: "same", plain: "same", status: "DONE", priority: 1 }),
    });
    const client = fakeClient({ fetchIssuesSince: async () => [] });
    const s = await runSync({ client, now: 9_500, force: true });
    expect(s.pushed).toBe(0);
    expect(client.updates).toHaveLength(0);
    const [n] = await db.select().from(node).where(eq(node.externalId, "ext-D"));
    expect(n.externalSyncedAt?.getTime()).toBe(9_500); // settled so it isn't re-evaluated forever
  });

  it("runs a forced sync even when paused, but skips the background one", async () => {
    await setLinearFlag({
      enabled: false,
      config: { apiKey: "lin_k", teamId: "team-1", stateMap: { DONE: "s-done" } },
    });
    const paused = await runSync({ client: fakeClient({ fetchIssuesSince: async () => [] }), now: 1_000 });
    expect(paused.skipped).toBe("Sync is paused");
    const forced = await runSync({ client: fakeClient({ fetchIssuesSince: async () => [] }), now: 1_000, force: true });
    expect(forced.skipped).toBeUndefined();
  });

  it("serializes overlapping runSync calls so a new issue is created only once", async () => {
    await connect();
    const client = fakeClient({ fetchIssuesSince: async () => [issueA] });
    const [a, b] = await Promise.all([runSync({ client, now: 1_000 }), runSync({ client, now: 2_000 })]);
    expect(a.created + b.created).toBe(1);
    expect(await db.$count(node, eq(node.externalId, "ext-A"))).toBe(1);
  });
});
