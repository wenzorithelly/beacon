import { db } from "@/lib/db-drizzle";
import { getActiveId, workspaceIdFromRequest } from "@/lib/workspaces";
import { ensureWatcher, isWatching } from "@/intel/watch-manager";

// Staleness signal for the code graph, attached to blast-radius / context responses so
// the agent knows whether the data it's reading is current. Also LAZILY warms a watcher
// for the queried repo (the recently-opened-subset boot may not cover it) — so the first
// query "wakes up" the repo and subsequent ones are live.
//
// Server-only: pulls in intel/watch-manager (→ chokidar). Never import from lib/code-graph
// (which the test suite loads) — keep this out of that import graph.
export async function codeGraphFreshness(
  req: Request,
): Promise<{ syncedAt: string | null; watching: boolean }> {
  const wsId = workspaceIdFromRequest(req) ?? getActiveId();
  if (wsId) ensureWatcher(wsId);
  const s = await db.query.syncState.findFirst({
    where: (t, { eq }) => eq(t.id, "singleton"),
    columns: { codeGraphSyncedAt: true },
  });
  return {
    syncedAt: s?.codeGraphSyncedAt ? s.codeGraphSyncedAt.toISOString() : null,
    watching: wsId ? isWatching(wsId) : false,
  };
}
