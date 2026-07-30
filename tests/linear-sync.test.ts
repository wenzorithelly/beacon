import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { getLinearFlag, setLinearFlag } from "@/lib/linear/config";
import { pickPrimaryTeam, runSync, type SyncClient } from "@/lib/linear/sync";
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
  stateId: "s-started",
  stateType: "started",
  stateName: "In Progress",
  stateColor: "#0f783c",
  labels: [],
  parentId: null,
  teamId: "team-1",
  teamKey: "V3",
  teamName: "Terra Nova",
  projectId: null,
  projectName: null,
  milestoneId: null,
  milestoneName: null,
  assigneeName: "Leticia",
  assigneeAvatarUrl: "https://a/leticia.png",
};

const scoped = (issues: LinearIssue[], complete = true): ScopedFetch => ({ issues, complete });

interface Fake extends SyncClient {
  updates: { id: string; patch: IssuePatch }[];
  stateMapCalls: string[];
  fetchArgs: { scopes: LinearScope[]; opts: { onlyMineViewerId?: string } }[];
  /** ids the closed-issue probe asked about, one entry per call (empty = never called). */
  probedIds: string[][];
}

function fakeClient(over: Partial<SyncClient> = {}): Fake {
  const updates: { id: string; patch: IssuePatch }[] = [];
  const stateMapCalls: string[] = [];
  const fetchArgs: { scopes: LinearScope[]; opts: { onlyMineViewerId?: string } }[] = [];
  const probedIds: string[][] = [];
  return {
    updates,
    stateMapCalls,
    fetchArgs,
    probedIds,
    resolveViewerAndOrg: async () => ({ viewerId: "me", viewerName: "Me", orgName: "Acme", orgUrlKey: "acme" }),
    fetchScopedOpenIssues: async (_k, scopes, opts) => {
      fetchArgs.push({ scopes, opts });
      return scoped([]);
    },
    // Default: nothing missing is still in scope — i.e. the pre-fix behaviour, so every existing
    // removal test keeps asserting exactly what it did before.
    fetchScopedIssuesByIds: async (_k, _s, ids) => {
      probedIds.push(ids);
      return [];
    },
    fetchTeamStates: async (_k, teamId) => {
      stateMapCalls.push(teamId);
      // A realistic team list: several states share a type, which is what the picker exists for.
      return [
        { id: "s-backlog", name: "Backlog", color: "#bec2c8", type: "backlog", position: 0 },
        { id: "s-todo", name: "Todo", color: "#e2e2e2", type: "unstarted", position: 1 },
        { id: "s-started", name: "In Progress", color: "#f2c94c", type: "started", position: 2 },
        { id: "s-review", name: "In Review", color: "#0f783c", type: "started", position: 3 },
        { id: "s-done", name: "Done", color: "#5e6ad2", type: "completed", position: 4 },
        { id: "s-cancel", name: "Canceled", color: "#95a2b3", type: "canceled", position: 5 },
      ];
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
    expect(s.skipped).toBe("Pick at least one team, project, or milestone first");
  });

  it("legacy `scope`-only config still syncs (via effectiveScopes)", async () => {
    // `connect()` below stores the legacy single `scope` field (no `scopes` array) — this is the
    // shape a pre-migration workspace has on disk, and effectiveScopes() must still resolve it.
    await connect();
    const fetched: LinearScope[][] = [];
    const client = fakeClient({
      fetchScopedOpenIssues: async (_k, scopes) => {
        fetched.push(scopes);
        return scoped([issueA]);
      },
    });
    const s = await runSync({ client, now: 1_000 });
    expect(s.created).toBe(1);
    expect(fetched[0]).toEqual([{ kind: "team", id: "team-1", name: "Terra Nova" }]);
  });

  it("syncs against a multi-scope `scopes` array (teams/projects/milestones mixed)", async () => {
    const multi: LinearScope[] = [
      { kind: "team", id: "team-1", name: "Terra Nova" },
      { kind: "project", id: "proj-1", name: "Shimizu PWA" },
    ];
    await connect({ scope: undefined, scopes: multi });
    const fetched: LinearScope[][] = [];
    const client = fakeClient({
      fetchScopedOpenIssues: async (_k, scopes) => {
        fetched.push(scopes);
        return scoped([issueA]);
      },
    });
    const s = await runSync({ client, now: 1_000 });
    expect(s.created).toBe(1);
    expect(fetched[0]).toEqual(multi);
  });

  it("creates a card for a scoped issue and captures the owner + real workflow state", async () => {
    await connect();
    const s = await runSync({ client: fakeClient({ fetchScopedOpenIssues: async () => scoped([issueA]) }), now: 1_000 });
    expect(s.created).toBe(1);
    const [n] = await db.select().from(node).where(eq(node.externalId, "ext-A"));
    expect(n.status).toBe("IN_PROGRESS");
    expect(n.assigneeName).toBe("Leticia");
    expect(n.hiddenAt).toBeNull();
    expect(JSON.parse(n.externalMeta!)).toEqual({
      state: { id: "s-started", name: "In Progress", color: "#0f783c", type: "started" },
      team: { id: "team-1", key: "V3", name: "Terra Nova" },
    });
  });

  it("backfills externalMeta on a noop for a pre-existing row — without triggering a push next pass", async () => {
    await connect();
    // Synced before the externalMeta column existed: unchanged on both sides (noop), no meta.
    await insertLinear({
      externalId: "ext-A",
      updatedAt: new Date(1_000),
      externalUpdatedAt: new Date(1_000),
      externalSyncedAt: new Date(1_000),
    });
    const client = fakeClient({ fetchScopedOpenIssues: async () => scoped([issueA]) }); // updatedAt 500 → noop
    await runSync({ client, now: 2_000, force: true });
    const [n] = await db.select().from(node).where(eq(node.externalId, "ext-A"));
    expect(JSON.parse(n.externalMeta!)).toEqual({
      state: { id: "s-started", name: "In Progress", color: "#0f783c", type: "started" },
      team: { id: "team-1", key: "V3", name: "Terra Nova" },
    });
    // Both LWW stamps advanced together, so the mirror write is not read as a user edit…
    expect(n.updatedAt.getTime()).toBe(2_000);
    expect(n.externalSyncedAt?.getTime()).toBe(2_000);
    // …and the next pass is a clean noop: nothing pushed, nothing sent to Linear.
    const s2 = await runSync({ client, now: 3_000, force: true });
    expect(s2.pushed).toBe(0);
    expect(client.updates).toEqual([]);
  });

  it("leaves a noop row untouched when externalMeta is already present", async () => {
    await connect();
    const meta = JSON.stringify({
      state: { name: "Old", color: "#111111", type: "started" },
      team: { id: "team-1", key: "V3", name: "Terra Nova" },
    });
    await insertLinear({
      externalId: "ext-A",
      externalMeta: meta,
      updatedAt: new Date(1_000),
      externalUpdatedAt: new Date(1_000),
      externalSyncedAt: new Date(1_000),
    });
    await runSync({ client: fakeClient({ fetchScopedOpenIssues: async () => scoped([issueA]) }), now: 2_000, force: true });
    const [n] = await db.select().from(node).where(eq(node.externalId, "ext-A"));
    expect(n.externalMeta).toBe(meta); // NOT refreshed on a noop — only backfilled when absent
    expect(n.updatedAt.getTime()).toBe(1_000); // row not written at all
  });

  it("writes the updated externalMeta on pull (Linear-side change wins)", async () => {
    await connect();
    await insertLinear({
      externalId: "ext-A",
      updatedAt: new Date(100),
      externalUpdatedAt: new Date(100),
      externalSyncedAt: new Date(100),
    });
    const changed = { ...issueA, updatedAt: 9_000, stateId: "s-done", stateName: "Done", stateColor: "#5e6ad2", stateType: "completed" };
    await runSync({ client: fakeClient({ fetchScopedOpenIssues: async () => scoped([changed]) }), now: 10_000, force: true });
    const [n] = await db.select().from(node).where(eq(node.externalId, "ext-A"));
    expect(n.status).toBe("DONE");
    expect(JSON.parse(n.externalMeta!)).toEqual({
      state: { id: "s-done", name: "Done", color: "#5e6ad2", type: "completed" },
      team: { id: "team-1", key: "V3", name: "Terra Nova" },
    });
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

  // Reported: "this ticket has 8 sub-issues in linear but only 7 here... once they were completed
  // they were gone from the board". The open fetch filters closed issues out, so completing one in
  // Linear read as "left the scope" and soft-hid the card. The probe re-asks about JUST the ids we
  // already track, closed states included, and the same scope applied.
  describe("a tracked card that got COMPLETED in Linear", () => {
    const done = { ...issueA, updatedAt: 9_000, stateId: "s-done", stateType: "completed", stateName: "Done" };

    it("lands in Done instead of vanishing off the board", async () => {
      await connect();
      await insertLinear({ externalId: "ext-A", status: "IN_PROGRESS" });
      const client = fakeClient({
        fetchScopedOpenIssues: async () => scoped([]), // closed → absent from the open set
        fetchScopedIssuesByIds: async () => [done],
      });
      const s = await runSync({ client, now: 10_000, force: true });
      expect(s.removed).toBe(0);
      const [n] = await db.select().from(node).where(eq(node.externalId, "ext-A"));
      expect(n.status).toBe("DONE");
      expect(n.hiddenAt).toBeNull();
    });

    it("comes BACK on the next pass if an earlier sync already hid it", async () => {
      await connect();
      await insertLinear({ externalId: "ext-A", status: "IN_PROGRESS", hiddenAt: new Date(1_500) });
      const client = fakeClient({
        fetchScopedOpenIssues: async () => scoped([]),
        fetchScopedIssuesByIds: async () => [done],
      });
      await runSync({ client, now: 10_000, force: true });
      const [n] = await db.select().from(node).where(eq(node.externalId, "ext-A"));
      expect(n.hiddenAt).toBeNull();
      expect(n.status).toBe("DONE");
    });

    it("probes ONLY ids already on the board, so a long-done issue is never imported", async () => {
      await connect();
      await insertLinear({ externalId: "ext-A" });
      // Linear answers with an extra closed issue nobody asked about — it must not become a card.
      const asked: string[][] = [];
      const client = fakeClient({
        fetchScopedOpenIssues: async () => scoped([]),
        fetchScopedIssuesByIds: async (_k, _s, ids) => {
          asked.push(ids);
          return [done, { ...issueA, id: "ext-ANCIENT", stateId: "s-done", stateType: "completed" }];
        },
      });
      const s = await runSync({ client, now: 10_000, force: true });
      expect(asked).toEqual([["ext-A"]]); // never the whole scope
      expect(s.created).toBe(0);
      expect(await db.select().from(node).where(eq(node.externalId, "ext-ANCIENT"))).toEqual([]);
    });

    it("still hides a card the probe does NOT return — genuinely out of scope", async () => {
      await connect();
      await insertLinear({ externalId: "ext-gone" });
      const s = await runSync({ client: fakeClient({ fetchScopedOpenIssues: async () => scoped([]) }), now: 2_000, force: true });
      expect(s.removed).toBe(1);
      const [n] = await db.select().from(node).where(eq(node.externalId, "ext-gone"));
      expect(n.hiddenAt?.getTime()).toBe(2_000);
    });

    it("skips the probe entirely on a truncated fetch (absence proves nothing there)", async () => {
      await connect();
      await insertLinear({ externalId: "ext-A" });
      const client = fakeClient({ fetchScopedOpenIssues: async () => scoped([], false) });
      await runSync({ client, now: 2_000, force: true });
      expect(client.probedIds).toEqual([]);
    });
  });

  // The workspace speaks ONE status vocabulary — the team's real workflow states — so a card that
  // belongs to no team (a Beacon-native one) still has a list to pick from.
  describe("the workspace status vocabulary", () => {
    it("caches the team's full state list, not just the Beacon-status map", async () => {
      await connect();
      await runSync({ client: fakeClient({ fetchScopedOpenIssues: async () => scoped([issueA]) }), now: 1_000, force: true });
      const { config } = await getLinearFlag();
      expect(config.statesByTeam?.["team-1"]?.map((s) => s.name)).toEqual([
        "Backlog",
        "Todo",
        "In Progress",
        "In Review",
        "Done",
        "Canceled",
      ]);
      expect(config.stateMapByTeam?.["team-1"]?.DONE).toBe("s-done");
    });

    it("names a primary team so Beacon-native cards have a vocabulary too", async () => {
      await connect();
      await runSync({ client: fakeClient({ fetchScopedOpenIssues: async () => scoped([issueA]) }), now: 1_000, force: true });
      expect((await getLinearFlag()).config.primaryTeamId).toBe("team-1");
    });

    it("resolves the vocabulary even when nothing synced (one team, zero open issues)", async () => {
      await connect();
      const client = fakeClient({ fetchScopedOpenIssues: async () => scoped([]) });
      await runSync({ client, now: 1_000, force: true });
      expect((await getLinearFlag()).config.statesByTeam?.["team-1"]).toBeDefined();
    });
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

// Which team's workflow states become the workspace's ONE status vocabulary. Pure, so it's tested
// directly: the fallback only shows up on a project/milestone/workspace scope, which carries no
// team id at all.
describe("pickPrimaryTeam", () => {
  const issue = (teamId: string): LinearIssue => ({ ...issueA, teamId });

  it("prefers the first team in scope — an explicit choice beats a head-count", () => {
    const scopes: LinearScope[] = [
      { kind: "project", id: "p1", name: "Shimizu" },
      { kind: "team", id: "team-2", name: "Plataform" },
      { kind: "team", id: "team-3", name: "Avocado" },
    ];
    expect(pickPrimaryTeam(scopes, [issue("team-9"), issue("team-9")])).toBe("team-2");
  });

  it("falls back to the team most synced issues belong to", () => {
    const scopes: LinearScope[] = [{ kind: "project", id: "p1", name: "Shimizu" }];
    expect(pickPrimaryTeam(scopes, [issue("t-a"), issue("t-b"), issue("t-b")])).toBe("t-b");
  });

  it("breaks a tie on the first team seen, so the vocabulary can't flip between passes", () => {
    const scopes: LinearScope[] = [{ kind: "workspace", id: "workspace", name: "Acme" }];
    expect(pickPrimaryTeam(scopes, [issue("t-a"), issue("t-b")])).toBe("t-a");
  });

  it("is undefined with nothing to go on (caller keeps the last known team)", () => {
    expect(pickPrimaryTeam([], [])).toBeUndefined();
  });
});
