import {
  ensureWorkspaceDb,
  getActiveId,
  resolveRequestWorkspaceId,
  runWithWorkspace,
} from "@/lib/workspaces";
import { ensureDefaultDb } from "@/lib/db-drizzle";

// Heal whatever db this request will ACTUALLY hit. With no pin the db proxy falls back to
// the global active workspace, and with no active one to the DEFAULT db (file:./dev.db) —
// which no other boundary provisions, so a zero-workspace request used to 500 on a stale
// schema. All three branches short-circuit once known-current this process.
async function ensureRequestDb(id: string | null): Promise<void> {
  if (id) {
    await ensureWorkspaceDb(id);
    return;
  }
  const active = getActiveId();
  if (active) await ensureWorkspaceDb(active);
  else await ensureDefaultDb();
}

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
    await ensureRequestDb(id);
    return runWithWorkspace(id, async () => handler(req, ...rest));
  };
}

// There is deliberately NO server-action twin of pinned() anymore. A server action gets
// no Request, so the best it could pin by was the browser-wide `beacon_ws` cookie
// (`pinnedAction`, now removed) — but each TAB pins its own workspace via ?ws + the
// x-beacon-workspace header (lib/tab-ws.ts), which the components/tab-workspace fetch
// interceptor attaches to /api/* requests ONLY, never to server-action POSTs. In a tab
// whose ?ws differed from the cookie, a cookie-pinned action silently mutated ANOTHER
// workspace's db (zero-row updates reported as success — the accept-suggestion bug).
// Canvas/browser mutations must go through pinned() API routes; don't add server actions
// that write workspace data.
