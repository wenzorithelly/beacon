import {
  BEACON_WS_COOKIE,
  ensureWorkspaceDb,
  getActiveId,
  getWorkspace,
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

// The server-action twin of pinned(): actions get no Request, so read the `beacon_ws`
// cookie via next/headers. Without this, a server action's bare `db` falls back to the
// GLOBAL active workspace — and a Details-panel/card action lands in whatever repo a
// background `beacon` run last activated instead of the one the browser is viewing
// (an accept-suggestion click silently updating zero rows in the wrong db).
// next/headers is imported lazily so this module stays loadable under `bun test`.
export async function pinnedAction<T>(fn: () => Promise<T>): Promise<T> {
  let id: string | null = null;
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const v = jar.get(BEACON_WS_COOKIE)?.value ?? null;
    id = v && getWorkspace(v) ? v : null;
  } catch {
    /* outside a request scope (CLI/test) — fall through to the active workspace */
  }
  await ensureRequestDb(id);
  return runWithWorkspace(id, fn);
}
