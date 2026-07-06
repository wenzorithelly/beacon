// The two-way sync core: given the local LINEAR-sourced nodes and the batch of Linear issues
// that changed since the last cursor, decide — per pair — which side wins (last-writer-wins by
// updatedAt) and what to do. PURE: no db, no network, no clock. The executor (lib/linear/sync.ts)
// carries out the returned decisions and stamps the markers.
//
// Two stored markers make the LWW decidable without a clock:
//   externalUpdatedAt — the Linear updatedAt we last mirrored → linearChanged = issue.updatedAt > it
//   externalSyncedAt  — wall-clock of our last write to the node → beaconChanged = node.updatedAt > it
// (an inbound apply also bumps node.updatedAt via $onUpdate, so we compare against the sync time,
//  not externalUpdatedAt, to tell a real user edit from our own mirror write.)
import type { LinearIssue, NodeStatus } from "@/lib/linear/types";

export interface LocalNode {
  id: string;
  externalId: string;
  updatedAt: number; // epoch-ms
  externalUpdatedAt: number | null;
  externalSyncedAt: number | null;
  // carried so the executor can build the write-back payload without a re-read
  title: string;
  plain: string | null;
  status: NodeStatus;
  priority: number;
  // last-known Linear-side values (from Node.externalSnapshot); the executor pushes only the
  // fields that differ from this. Undefined for a node never synced back. The planner ignores it.
  snapshot?: { title: string; plain: string | null; status: NodeStatus; priority: number } | null;
}

export type Decision =
  | { action: "create"; issue: LinearIssue }
  | { action: "pull"; node: LocalNode; issue: LinearIssue }
  | { action: "push"; node: LocalNode; issue: LinearIssue | null }
  | { action: "noop"; node: LocalNode };

export function planReconcile(locals: LocalNode[], issues: LinearIssue[]): Decision[] {
  const byExt = new Map(locals.map((n) => [n.externalId, n]));
  const seen = new Set<string>();
  const out: Decision[] = [];

  for (const issue of issues) {
    const node = byExt.get(issue.id);
    if (!node) {
      out.push({ action: "create", issue });
      continue;
    }
    seen.add(node.id);
    const linearChanged = issue.updatedAt > (node.externalUpdatedAt ?? 0);
    const beaconChanged = node.updatedAt > (node.externalSyncedAt ?? 0);
    if (linearChanged && beaconChanged) {
      // tie → Linear wins (deterministic)
      out.push(issue.updatedAt >= node.updatedAt ? { action: "pull", node, issue } : { action: "push", node, issue });
    } else if (linearChanged) {
      out.push({ action: "pull", node, issue });
    } else if (beaconChanged) {
      out.push({ action: "push", node, issue });
    } else {
      out.push({ action: "noop", node });
    }
  }

  // A local edit whose issue did NOT change won't appear in the delta — sweep the rest.
  for (const node of locals) {
    if (seen.has(node.id)) continue;
    if (node.updatedAt > (node.externalSyncedAt ?? 0)) {
      out.push({ action: "push", node, issue: null });
    }
  }

  return out;
}
