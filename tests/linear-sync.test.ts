import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { setLinearFlag } from "@/lib/linear/config";
import { runSync, type SyncClient } from "@/lib/linear/sync";
import type { IssuePatch, ScopedFetch } from "@/lib/linear/client";
import type { LinearIssue, LinearScope } from "@/lib/linear/types";
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
  teamId: "team-1",
  teamKey: "V3",
  projectName: null,
  assigneeName: "Leticia",
  assigneeAvatarUrl: "https://a/leticia.png",
};

const scoped = (issues: LinearIssue[], complete = true): ScopedFetch => ({ issues, complete });

interface Fake extends SyncClient {
  updates: { id: string; patch: IssuePatch }[];
  stateMapCalls: string[];
  fetchArgs: { scope: LinearScope; opts: { onlyMineViewerId?: string } }[];
}

function fakeClient(over: Partial<SyncClient> = {}): Fake {
  const updates: { id: string; patch: IssuePatch }[] = [];
  const stateMapCalls: string[] = [];
  const fetchArgs: { scope: LinearScope; opts: { onlyMineViewerId?: string } }[] = [];
  return {
    updates,
    stateMapCalls,
    fetchArgs,
    resolveViewerAndOrg: async () => ({ viewerId: "me", viewerName: "Me", orgName: "Acme", orgUrlKey: "acme" }),
    fetchScopedOpenIssues: async (_k, scope, opts) => {
      fetchArgs.push({ scope, opts });
      return scoped([]);
    },
    resolveStateMap: async (_k, teamId) => {
      stateMapCalls.push(teamId);
      return { DONE: "s-done", IN_PROGRESS: "s-started", BLOCKED: "s-started" };
    },
    updateIssue: async (_k, id, patch) => {
      updates.push({ id, patch });
      return 6_000;
    },
    ...over,
  };
}

async function connect(extra: Record<string, unknown> = {}) {
  await setLinearFlag({
    enabled: true,
    config: {
      apiKey: "lin_k",
      viewerId: "me",
      viewerName: "Me",
      orgName: "Acme",
      scope: { kind: "team", id: "team-1", name: "Terra Nova" },
      stateMapByTeam: { "team-1": { DONE: "s-done", IN_PROGRESS: "s-started", BLOCKED: "s-started" } },
      ...extra,
    },
  });
}

const insertLinear = (over: Record<string, unknown>) =>
  db.insert(node).values({
    view: "ROADMAP",
    title: "T",
    status: "IN_PROGRESS",
    priority: 2,
    source: "LINEAR",
    updatedAt: new Date(1_000),
    externalUpdatedAt: new Date(1_000),
    externalSyncedAt: new Date(1_000),
    externalSnapshot: JSON.stringify({ title: "T", plain: null, status: "IN_PROGRESS", priority: 2 }),
    ...over,
  });

describe("runSync (v2 — scoped, full-set, soft-hide)", () => {
  it("skips when no scope is chosen", async () => {
    await setLinearFlag({ enabled: true, config: { apiKey: "lin_k", viewerId: "me" } });
    const s = await runSync({ client: fakeClient(), now: 1_000 });
    expect(s.skipped).toBe("Pick a team or project first");
  });

  it("creates a card for a scoped issue and captures the owner", async () => {
    await connect();
    const s = await runSync({ client: fakeClient({ fetchScopedOpenIssues: async () => scoped([issueA]) }), now: 1_000 });
    expect(s.created).toBe(1);
    const [n] = await db.select().from(node).where(eq(node.externalId, "ext-A"));
    expect(n.status).toBe("IN_PROGRESS");
    expect(n.assigneeName).toBe("Leticia");
    expect(n.hiddenAt).toBeNull();
  });

  it("SOFT-hides (not deletes) a card whose issue left the set — row + position survive", async () => {
    await connect();
    await insertLinear({ externalId: "ext-gone", x: 42, y: 7 });
    const s = await runSync({ client: fakeClient({ fetchScopedOpenIssues: async () => scoped([]) }), now: 2_000, force: true });
    expect(s.removed).toBe(1);
    const [n] = await db.select().from(node).where(eq(node.externalId, "ext-gone"));
    expect(n).toBeDefined(); // NOT deleted
    expect(n.hiddenAt?.getTime()).toBe(2_000);
    expect(n.x).toBe(42); // position preserved
  });

  it("un-hides a card when its issue returns to the set", async () => {
    await connect();
    await insertLinear({ externalId: "ext-A", hiddenAt: new Date(1_500) });
    await runSync({ client: fakeClient({ fetchScopedOpenIssues: async () => scoped([issueA]) }), now: 3_000, force: true });
    const [n] = await db.select().from(node).where(eq(node.externalId, "ext-A"));
    expect(n.hiddenAt).toBeNull();
  });

  it("does NOT hide anything when the fetch was truncated (complete:false)", async () => {
    await connect();
    await insertLinear({ externalId: "ext-gone" });
    const s = await runSync({ client: fakeClient({ fetchScopedOpenIssues: async () => scoped([], false) }), now: 2_000, force: true });
    expect(s.removed).toBe(0);
    const [n] = await db.select().from(node).where(eq(node.externalId, "ext-gone"));
    expect(n.hiddenAt).toBeNull();
  });

  it("clears parentId when a sub-issue is detached in Linear", async () => {
    await connect();
    const [parent] = await insertLinear({ externalId: "ext-P", title: "Parent" }).returning();
    await insertLinear({ externalId: "ext-C", title: "Child", parentId: parent.id });
    const parentIssue = { ...issueA, id: "ext-P", updatedAt: 1_000, parentId: null };
    const childIssue = { ...issueA, id: "ext-C", updatedAt: 1_000, parentId: null }; // detached
    await runSync({ client: fakeClient({ fetchScopedOpenIssues: async () => scoped([parentIssue, childIssue]) }), now: 1_000, force: true });
    const [child] = await db.select().from(node).where(eq(node.externalId, "ext-C"));
    expect(child.parentId).toBeNull();
  });

  it("one failing push does not abort the pass — removals still run", async () => {
    await connect();
    // ext-bad has a local title edit → will push, and the fake rejects the push.
    await insertLinear({
      externalId: "ext-bad",
      title: "edited",
      updatedAt: new Date(5_000),
      externalSnapshot: JSON.stringify({ title: "orig", plain: null, status: "IN_PROGRESS", priority: 2 }),
    });
    await insertLinear({ externalId: "ext-gone" }); // not in the set → should be hidden
    const badIssue = { ...issueA, id: "ext-bad", updatedAt: 1_000 };
    const client = fakeClient({
      fetchScopedOpenIssues: async () => scoped([badIssue]),
      updateIssue: async () => {
        throw new Error("Linear rejected the update");
      },
    });
    const s = await runSync({ client, now: 6_000, force: true });
    expect(s.pushed).toBe(0); // the push threw
    expect(s.removed).toBe(1); // but the removal still ran
    const [gone] = await db.select().from(node).where(eq(node.externalId, "ext-gone"));
    expect(gone.hiddenAt?.getTime()).toBe(6_000);
  });

  it("passes the viewer id to the fetch only when onlyMine is on", async () => {
    await connect({ onlyMine: true });
    const c = fakeClient();
    await runSync({ client: c, now: 1_000 });
    expect(c.fetchArgs[0].opts.onlyMineViewerId).toBe("me");
    await connect({ onlyMine: false });
    const c2 = fakeClient();
    await runSync({ client: c2, now: 1_000 });
    expect(c2.fetchArgs[0].opts.onlyMineViewerId).toBeUndefined();
  });

  it("pushes a BLOCKED status as the team's started state (no silent no-op)", async () => {
    await connect();
    await insertLinear({
      externalId: "ext-A",
      status: "BLOCKED",
      updatedAt: new Date(5_000),
      externalSnapshot: JSON.stringify({ title: "T", plain: null, status: "IN_PROGRESS", priority: 2 }),
    });
    const client = fakeClient({ fetchScopedOpenIssues: async () => scoped([{ ...issueA, updatedAt: 1_000 }]) });
    const s = await runSync({ client, now: 6_000, force: true });
    expect(s.pushed).toBe(1);
    expect(client.updates[0].patch).toEqual({ stateId: "s-started" });
  });

  it("serializes overlapping runSync calls so a new issue is created only once", async () => {
    await connect();
    const client = fakeClient({ fetchScopedOpenIssues: async () => scoped([issueA]) });
    const [a, b] = await Promise.all([runSync({ client, now: 1_000 }), runSync({ client, now: 2_000 })]);
    expect(a.created + b.created).toBe(1);
    expect(await db.$count(node, eq(node.externalId, "ext-A"))).toBe(1);
  });
});
