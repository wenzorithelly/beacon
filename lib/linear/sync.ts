// Executor for one reconcile pass. Loads the workspace's Linear config + local LINEAR nodes, fetches
// the FULL current scoped set (open issues in the team/project, optionally assignee=me), runs the
// pure planReconcile, then applies each decision — create/pull/push/remove — and stamps the LWW
// markers. Both directions in one pass, no per-mutation hooks. The client is injectable for tests.
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { resolveHasFrontend } from "@/lib/project-meta";
import { getLinearFlag, setLinearFlag } from "@/lib/linear/config";
import * as realClient from "@/lib/linear/client";
import type { IssuePatch, ScopedFetch, ViewerOrg } from "@/lib/linear/client";
import { beaconPriorityToLinear, issueToNodeFields } from "@/lib/linear/mapping";
import { planReconcile, type LocalNode } from "@/lib/linear/reconcile";
import { effectiveScopes, type LinearIssue, type LinearScope, type NodeStatus } from "@/lib/linear/types";

export interface SyncClient {
  resolveViewerAndOrg: (apiKey: string) => Promise<ViewerOrg>;
  fetchScopedOpenIssues: (
    apiKey: string,
    scopes: LinearScope[],
    opts: { onlyMineViewerId?: string },
  ) => Promise<ScopedFetch>;
  resolveStateMap: (apiKey: string, teamId: string) => Promise<Partial<Record<NodeStatus, string>>>;
  updateIssue: (apiKey: string, id: string, patch: IssuePatch) => Promise<number>;
}

export interface SyncSummary {
  skipped?: string;
  created: number;
  pulled: number;
  pushed: number;
  removed: number;
}

type Snapshot = { title: string; plain: string | null; status: NodeStatus; priority: number };

const ms = (d: Date | null): number | null => (d ? d.getTime() : null);
const snapshotOf = (n: { title: string; plain: string | null; status: NodeStatus; priority: number }): Snapshot => ({
  title: n.title,
  plain: n.plain,
  status: n.status,
  priority: n.priority,
});

// Process-wide serialization: the daemon tick and the manual "Sync now" route both call runSync, and
// a pass can outlast the interval — without this, two overlapping passes each `create` the same issue
// (Node.externalId has no unique constraint) → duplicate cards. One chain, single process.
let chain: Promise<unknown> = Promise.resolve();

export function runSync(opts: { client?: SyncClient; now?: number; force?: boolean } = {}): Promise<SyncSummary> {
  const next = chain.then(
    () => runSyncInner(opts),
    () => runSyncInner(opts),
  );
  chain = next.catch(() => {});
  return next;
}

async function runSyncInner(opts: { client?: SyncClient; now?: number; force?: boolean }): Promise<SyncSummary> {
  const client = opts.client ?? realClient;
  const now = opts.now ?? Date.now();
  const summary: SyncSummary = { created: 0, pulled: 0, pushed: 0, removed: 0 };

  const { enabled, config } = await getLinearFlag();
  if (!config?.apiKey) return { ...summary, skipped: "Connect Linear first" };
  const scopes = effectiveScopes(config);
  if (scopes.length === 0) return { ...summary, skipped: "Pick at least one team, project, or milestone first" };
  if (!enabled && !opts.force) return { ...summary, skipped: "Sync is paused" };

  // Resolve who the key is + its workspace once (needed for the assignee filter + display).
  let viewerId = config.viewerId;
  if (!viewerId) {
    const vo = await client.resolveViewerAndOrg(config.apiKey);
    viewerId = vo.viewerId;
    await setLinearFlag({
      config: { viewerId: vo.viewerId, viewerName: vo.viewerName, orgName: vo.orgName, orgUrlKey: vo.orgUrlKey },
    });
  }

  const { issues, complete } = await client.fetchScopedOpenIssues(
    config.apiKey,
    scopes,
    config.onlyMine ? { onlyMineViewerId: viewerId } : {},
  );

  const rows = await db.select().from(node).where(eq(node.source, "LINEAR"));
  const locals: LocalNode[] = rows.map((r) => ({
    id: r.id,
    externalId: r.externalId ?? "",
    updatedAt: r.updatedAt.getTime(),
    externalUpdatedAt: ms(r.externalUpdatedAt),
    externalSyncedAt: ms(r.externalSyncedAt),
    title: r.title,
    plain: r.plain,
    status: r.status as NodeStatus,
    priority: r.priority,
    snapshot: r.externalSnapshot ? (JSON.parse(r.externalSnapshot) as Snapshot) : null,
  }));
  // externalIds currently soft-hidden — any that turn up in the fetched set get un-hidden, even if
  // the issue is otherwise unchanged (a plain `noop`).
  const hiddenIds = new Set(rows.filter((r) => r.hiddenAt).map((r) => r.externalId));

  // Linear has no layer; only carry one where the workspace has a frontend (AGENTS.md).
  const layer = (await resolveHasFrontend()) ? "fullstack" : null;

  // Workflow states are per-team; the scope can span teams, so resolve + cache per team on demand.
  const stateMapByTeam: Record<string, Partial<Record<NodeStatus, string>>> = { ...(config.stateMapByTeam ?? {}) };
  let stateMapDirty = false;
  const stateIdFor = async (teamId: string, status: NodeStatus): Promise<string | undefined> => {
    if (!stateMapByTeam[teamId]) {
      stateMapByTeam[teamId] = await client.resolveStateMap(config.apiKey, teamId);
      stateMapDirty = true;
    }
    return stateMapByTeam[teamId]?.[status];
  };

  for (const d of planReconcile(locals, issues)) {
    // A truncated fetch (complete=false) is NOT authoritative about what's absent, so never hide on
    // it — a card missing only because the pull was capped would otherwise vanish then re-appear.
    if (d.action === "remove" && !complete) continue;
    try {
      if (d.action === "create") {
        const f = issueToNodeFields(d.issue);
        await db.insert(node).values({
          view: "ROADMAP",
          ...f,
          layer,
          updatedAt: new Date(now),
          externalUpdatedAt: new Date(d.issue.updatedAt),
          externalSyncedAt: new Date(now),
          externalSnapshot: JSON.stringify(snapshotOf(f)),
          hiddenAt: null,
        });
        summary.created++;
      } else if (d.action === "pull") {
        const f = issueToNodeFields(d.issue);
        await db
          .update(node)
          .set({
            title: f.title,
            plain: f.plain,
            status: f.status,
            priority: f.priority,
            kind: f.kind,
            cluster: f.cluster,
            sourceRef: f.sourceRef,
            assigneeName: f.assigneeName,
            assigneeAvatarUrl: f.assigneeAvatarUrl,
            externalMeta: f.externalMeta,
            updatedAt: new Date(now),
            externalUpdatedAt: new Date(d.issue.updatedAt),
            externalSyncedAt: new Date(now),
            externalSnapshot: JSON.stringify(snapshotOf(f)),
            hiddenAt: null, // returned to the scope → un-hide
          })
          .where(eq(node.id, d.node.id));
        summary.pulled++;
      } else if (d.action === "push") {
        // Push ONLY the fields changed in Beacon vs the last-mirrored snapshot (never clobber
        // priority/description, never fire on a drag). Priority only when the snapshot shows it moved.
        const snap = d.node.snapshot;
        const patch: IssuePatch = {};
        if (!snap || d.node.title !== snap.title) patch.title = d.node.title;
        if (!snap || (d.node.plain ?? "") !== (snap.plain ?? "")) patch.description = d.node.plain ?? "";
        if (snap && d.node.priority !== snap.priority) patch.priority = beaconPriorityToLinear(d.node.priority);
        if (!snap || d.node.status !== snap.status) {
          const stateId = await stateIdFor(d.issue.teamId, d.node.status);
          if (stateId) patch.stateId = stateId;
        }

        const set: Record<string, unknown> = { updatedAt: new Date(now), externalSyncedAt: new Date(now), hiddenAt: null };
        if (Object.keys(patch).length > 0) {
          const newUpdatedAt = await client.updateIssue(config.apiKey, d.node.externalId, patch);
          set.externalUpdatedAt = new Date(newUpdatedAt);
          set.externalSnapshot = JSON.stringify(snapshotOf(d.node));
          summary.pushed++;
        }
        await db.update(node).set(set).where(eq(node.id, d.node.id));
      } else if (d.action === "noop") {
        // Unchanged, but if it was hidden and is back in the set, bring it back onto the board.
        if (hiddenIds.has(d.node.externalId)) {
          await db.update(node).set({ hiddenAt: null }).where(eq(node.id, d.node.id));
        }
      } else if (d.action === "remove") {
        // Left the scope (unassigned / closed / moved out, or filtered by a scope/only-mine change).
        // SOFT-hide — keep the row so positions, edges and annotations survive; un-hidden if the
        // issue returns. Never db.delete (that cascades onto manual sub-tasks via the parentId FK).
        await db.update(node).set({ hiddenAt: new Date(now) }).where(eq(node.id, d.node.id));
        summary.removed++;
      }
    } catch (e) {
      // One bad card (stale stateId, Linear rejects a push, a team's state resolve 500s) must not
      // abort the whole pass — skip it and keep going so removals + later cards still process.
      console.error(`[beacon-linear] ${d.action} failed for a card:`, e instanceof Error ? e.message : e);
    }
  }

  await relinkParents(issues, now);

  if (stateMapDirty) await setLinearFlag({ config: { stateMapByTeam } });
  await setLinearFlag({ config: { lastSyncedAt: new Date(now).toISOString() } });
  return summary;
}

// Reconcile parent → sub-task nesting for the fetched issues, in BOTH directions: a new/changed
// parent links, and a parent CLEARED in Linear (issue.parentId now null, or the parent left the
// scope) un-nests the card. Runs after the apply loop so a parent created this pass is linkable.
async function relinkParents(issues: LinearIssue[], now: number): Promise<void> {
  const linearNodes = await db
    .select({ id: node.id, externalId: node.externalId, parentId: node.parentId })
    .from(node)
    .where(eq(node.source, "LINEAR"));
  const byExt = new Map(linearNodes.map((n) => [n.externalId, n]));
  for (const issue of issues) {
    const child = byExt.get(issue.id);
    if (!child) continue;
    const desired = issue.parentId ? (byExt.get(issue.parentId)?.id ?? null) : null;
    if (child.parentId !== desired) {
      await db.update(node).set({ parentId: desired, updatedAt: new Date(now) }).where(eq(node.id, child.id));
    }
  }
}
