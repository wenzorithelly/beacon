// Executor for one reconcile pass. Loads the workspace's Linear config + local LINEAR nodes,
// pulls the Linear delta, runs the pure planReconcile, then applies each decision to the db /
// pushes to Linear and stamps the LWW markers. Both directions in one pass — no per-mutation hooks.
// The Linear client is injectable so tests drive it with a fake (tests/linear-sync.test.ts).
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { resolveHasFrontend } from "@/lib/project-meta";
import { getLinearFlag, setLinearFlag } from "@/lib/linear/config";
import * as realClient from "@/lib/linear/client";
import type { IssuePatch } from "@/lib/linear/client";
import { beaconPriorityToLinear, issueToNodeFields } from "@/lib/linear/mapping";
import { planReconcile, type LocalNode } from "@/lib/linear/reconcile";
import type { LinearIssue, NodeStatus } from "@/lib/linear/types";

export interface SyncClient {
  resolveStateMap: (apiKey: string, teamId: string) => Promise<Partial<Record<NodeStatus, string>>>;
  fetchIssuesSince: (apiKey: string, teamId: string, sinceISO?: string) => Promise<LinearIssue[]>;
  updateIssue: (apiKey: string, id: string, patch: IssuePatch) => Promise<number>;
}

export interface SyncSummary {
  skipped?: string;
  created: number;
  pulled: number;
  pushed: number;
}

type Snapshot = { title: string; plain: string | null; status: NodeStatus; priority: number };

const ms = (d: Date | null): number | null => (d ? d.getTime() : null);
const snapshotOf = (n: { title: string; plain: string | null; status: NodeStatus; priority: number }): Snapshot => ({
  title: n.title,
  plain: n.plain,
  status: n.status,
  priority: n.priority,
});

// Process-wide serialization: the daemon tick and the manual "Sync now" route both call runSync,
// and a pass can outlast the 60s interval — without this, two overlapping passes each `create` the
// same issue (Node.externalId has no unique constraint) → duplicate cards. One chain, single process.
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
  const summary: SyncSummary = { created: 0, pulled: 0, pushed: 0 };

  const { enabled, config } = await getLinearFlag();
  if (!config?.apiKey || !config?.teamId) {
    return { ...summary, skipped: "Connect Linear and pick a team first" };
  }
  // Manual "Sync now" (force) runs even when paused; the background daemon respects the pause.
  if (!enabled && !opts.force) return { ...summary, skipped: "Sync is paused" };

  // Resolve the team's workflow-state ids once (needed to write status back).
  let stateMap = config.stateMap;
  if (!stateMap) {
    stateMap = await client.resolveStateMap(config.apiKey, config.teamId);
    await setLinearFlag({ config: { stateMap } });
  }

  const issues = await client.fetchIssuesSince(config.apiKey, config.teamId, config.lastCursor);

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

  // Linear has no layer; only carry one where the workspace has a frontend (AGENTS.md).
  const layer = (await resolveHasFrontend()) ? "fullstack" : null;

  for (const d of planReconcile(locals, issues)) {
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
          updatedAt: new Date(now),
          externalUpdatedAt: new Date(d.issue.updatedAt),
          externalSyncedAt: new Date(now),
          externalSnapshot: JSON.stringify(snapshotOf(f)),
        })
        .where(eq(node.id, d.node.id));
      summary.pulled++;
    } else if (d.action === "push") {
      // Push ONLY the fields that changed in Beacon vs the last-mirrored snapshot — never clobber
      // priority/description (or fire at all) on an unrelated edit like a canvas drag. Priority is
      // pushed only when we KNOW it changed (snapshot present), so a Linear "No priority" issue is
      // never silently bumped to Medium.
      const snap = d.node.snapshot;
      const patch: IssuePatch = {};
      if (!snap || d.node.title !== snap.title) patch.title = d.node.title;
      if (!snap || (d.node.plain ?? "") !== (snap.plain ?? "")) patch.description = d.node.plain ?? "";
      if (snap && d.node.priority !== snap.priority) patch.priority = beaconPriorityToLinear(d.node.priority);
      if (!snap || d.node.status !== snap.status) {
        const stateId = stateMap?.[d.node.status];
        if (stateId) patch.stateId = stateId;
      }

      const set: Record<string, unknown> = { updatedAt: new Date(now), externalSyncedAt: new Date(now) };
      if (Object.keys(patch).length > 0) {
        const newUpdatedAt = await client.updateIssue(config.apiKey, d.node.externalId, patch);
        set.externalUpdatedAt = new Date(newUpdatedAt);
        set.externalSnapshot = JSON.stringify(snapshotOf(d.node));
        summary.pushed++;
      }
      // Even with an empty patch (e.g. a drag bumped updatedAt), advance externalSyncedAt so the
      // node isn't re-evaluated as "beacon-changed" every tick.
      await db.update(node).set(set).where(eq(node.id, d.node.id));
    }
  }

  // Re-link parent → sub-task nesting from this batch (a parent may have been created this pass).
  await relinkParents(issues);

  // Advance the cursor to the newest issue we saw, so the next delta only fetches later changes.
  if (issues.length) {
    const maxMs = Math.max(...issues.map((i) => i.updatedAt));
    await setLinearFlag({ config: { lastCursor: new Date(maxMs).toISOString() } });
  }

  return summary;
}

async function relinkParents(issues: LinearIssue[]): Promise<void> {
  const withParent = issues.filter((i) => i.parentId);
  if (!withParent.length) return;
  const linearNodes = await db
    .select({ id: node.id, externalId: node.externalId, parentId: node.parentId })
    .from(node)
    .where(eq(node.source, "LINEAR"));
  const byExt = new Map(linearNodes.map((n) => [n.externalId, n]));
  for (const issue of withParent) {
    const child = byExt.get(issue.id);
    const parent = byExt.get(issue.parentId!);
    if (child && parent && child.parentId !== parent.id) {
      await db.update(node).set({ parentId: parent.id }).where(eq(node.id, child.id));
    }
  }
}
