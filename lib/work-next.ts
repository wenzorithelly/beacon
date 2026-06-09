// "Work on next" — deterministically pick the one feature the user should pick up next, so
// the board answers "where do I start?" without reading every card. No AI/CLI: pure ordering
// over the roadmap's own status / priority / dependency data.
//
// Rule, over TOP-LEVEL features only:
//   1. If anything is already IN_PROGRESS, surface that (lowest priority number wins, then the
//      earliest one in input order) — finish what's started before opening new work.
//   2. Otherwise the highest-priority (0 = critical first) PENDING feature that is NOT blocked.
// A feature is blocked when any feature it depends on (DEPENDS edge from→to) is not yet
// DONE or CANCELLED. Returns the feature id, or null when there's nothing actionable.

export interface WorkNextNode {
  id: string;
  parentId: string | null;
  status: string;
  priority: number;
}

export interface WorkNextEdge {
  fromId: string;
  toId: string;
  kind: string;
}

const SATISFIED = new Set(["DONE", "CANCELLED"]);

export function pickWorkOnNext(
  nodes: WorkNextNode[],
  edges: WorkNextEdge[],
): string | null {
  const statusById = new Map(nodes.map((n) => [n.id, n.status]));

  const isBlocked = (id: string): boolean =>
    edges.some(
      (e) =>
        e.kind === "DEPENDS" &&
        e.fromId === id &&
        !SATISFIED.has(statusById.get(e.toId) ?? ""),
    );

  // Input order is the tie-breaker ("earliest"); the caller queries by createdAt asc.
  const topLevel = nodes.filter((n) => !n.parentId);
  // Lowest priority number wins; on ties the first in input order (only replace on strictly <).
  const bestByPriority = (cands: WorkNextNode[]): WorkNextNode | null => {
    let best: WorkNextNode | null = null;
    for (const n of cands) {
      if (best === null || n.priority < best.priority) best = n;
    }
    return best;
  };

  const inProgress = bestByPriority(topLevel.filter((n) => n.status === "IN_PROGRESS"));
  if (inProgress) return inProgress.id;

  const pending = bestByPriority(
    topLevel.filter((n) => n.status === "PENDING" && !isBlocked(n.id)),
  );
  return pending?.id ?? null;
}
