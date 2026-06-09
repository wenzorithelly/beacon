import { ensureWorkspaceDb, resolveRequestWorkspaceId, runWithWorkspace } from "@/lib/workspaces";

// Wrap a route handler so its whole execution is pinned to the request's workspace —
// the `x-beacon-workspace` header (agent) or the `beacon_ws` cookie (browser selection),
// falling back to the global active when neither is present. Use on every browser-facing
// data route (canvas reads/writes) so an edit lands in the workspace the user is VIEWING,
// not the global active one a background agent may have flipped.
//
// `db` / `dataDir()` / `repoRoot()` all consult the pin first, so wrapping the handler is
// enough — nothing inside needs to know about workspaces.
//
// We `await ensureWorkspaceDb` BEFORE running the handler: the sync `db` Proxy getter no longer
// self-heals (the libSQL migrator is async), so this request boundary is where a missing/behind
// db gets provisioned + migrated. It short-circuits once the file is known-current this process,
// so it's cheap on the hot path.
export function pinned<A extends unknown[]>(
  handler: (req: Request, ...rest: A) => Response | Promise<Response>,
): (req: Request, ...rest: A) => Promise<Response> {
  return async (req, ...rest) => {
    const id = await resolveRequestWorkspaceId(req);
    if (id) await ensureWorkspaceDb(id);
    return runWithWorkspace(id, async () => handler(req, ...rest));
  };
}
