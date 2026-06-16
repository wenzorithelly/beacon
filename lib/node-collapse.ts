// Collapsing a feature folds its sub-tasks behind it: the parent stays visible, every node in the
// subtree under it hides. Given the roadmap nodes (each with a parentId) and the set of collapsed
// parent ids, return the set of node ids to HIDE — all descendants of any collapsed node, at any
// depth. Pure + client-safe so the canvas and the test both use one definition. Cycle-safe.
export function collapsedDescendants(
  nodes: ReadonlyArray<{ id: string; parentId: string | null }>,
  collapsed: ReadonlySet<string>,
): Set<string> {
  const hidden = new Set<string>();
  if (collapsed.size === 0) return hidden;

  const childrenByParent = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const arr = childrenByParent.get(n.parentId);
    if (arr) arr.push(n.id);
    else childrenByParent.set(n.parentId, [n.id]);
  }

  // BFS/DFS from each collapsed root; the `hidden` guard makes a malformed parent cycle terminate.
  const stack = [...collapsed];
  while (stack.length) {
    const parent = stack.pop()!;
    for (const child of childrenByParent.get(parent) ?? []) {
      if (hidden.has(child)) continue;
      hidden.add(child);
      stack.push(child);
    }
  }
  return hidden;
}

/** Direct-child count per node id — drives whether a card shows the collapse toggle (and its N). */
export function childCounts(
  nodes: ReadonlyArray<{ id: string; parentId: string | null }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    counts.set(n.parentId, (counts.get(n.parentId) ?? 0) + 1);
  }
  return counts;
}
