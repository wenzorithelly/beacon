// "Work order" — deterministically enumerate the next few features the user should pick up, so
// the board answers "where do I start?" (and what comes after) without reading every card. No
// AI/CLI: pure ordering over the roadmap's own status / priority / dependency data.
//
// `rankWorkOrder` returns up to `limit` TOP-LEVEL feature ids as a topologically-valid sequence:
//   - candidates are PENDING / IN_PROGRESS features (terminal/parked states never get a slot);
//   - each slot picks the best AVAILABLE candidate — IN_PROGRESS first (you don't re-block work
//     in flight), then highest-priority (0 = critical) PENDING whose dependencies are all
//     satisfied, with the earliest in input order breaking ties (caller queries createdAt asc);
//   - placing a pick marks it satisfied, so it unblocks its dependents for the NEXT slot — the
//     result is an order you could actually execute (a dependency never trails the thing that
//     needs it). A dependency is satisfied when the depended-on feature is DONE or CANCELLED.
// `pickWorkOnNext` is the head of that sequence (or null when nothing is actionable).

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
const ELIGIBLE = new Set(["PENDING", "IN_PROGRESS"]);

export function rankWorkOrder(
  nodes: WorkNextNode[],
  edges: WorkNextEdge[],
  limit = 3,
): string[] {
  // Actionable top-level features only — sub-tasks and terminal/parked states never get a slot.
  const pool = nodes.filter((n) => !n.parentId && ELIGIBLE.has(n.status));

  // Ids treated as "done" for dependency purposes: real DONE/CANCELLED to start, then grows as
  // each pick is placed so its dependents become available for the next slot (topological).
  const satisfied = new Set(
    nodes.filter((n) => SATISFIED.has(n.status)).map((n) => n.id),
  );
  // IN_PROGRESS is never re-blocked — you keep going on work already in flight.
  const depsSatisfied = (id: string): boolean =>
    edges.every(
      (e) => !(e.kind === "DEPENDS" && e.fromId === id) || satisfied.has(e.toId),
    );

  const order: string[] = [];
  const placed = new Set<string>();
  while (order.length < limit) {
    const available = pool.filter(
      (n) =>
        !placed.has(n.id) && (n.status === "IN_PROGRESS" || depsSatisfied(n.id)),
    );
    if (available.length === 0) break; // nothing actionable (or a dependency cycle) → stop

    // Prefer in-progress; among the chosen set, lowest priority number wins (earliest on ties).
    const inProgress = available.filter((n) => n.status === "IN_PROGRESS");
    const cands = inProgress.length ? inProgress : available;
    let best = cands[0];
    for (const n of cands) {
      if (n.priority < best.priority) best = n;
    }

    order.push(best.id);
    placed.add(best.id);
    satisfied.add(best.id); // placing it unblocks its dependents for the next slot
  }
  return order;
}

export function pickWorkOnNext(
  nodes: WorkNextNode[],
  edges: WorkNextEdge[],
): string | null {
  return rankWorkOrder(nodes, edges, 1)[0] ?? null;
}
