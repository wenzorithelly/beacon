import { NextResponse } from "next/server";
import {
  BEACON_WS_COOKIE,
  dbUrlFor,
  ensureWorkspaceDb,
  getWorkspace,
  setActiveId,
} from "@/lib/workspaces";
import { invalidateDb } from "@/lib/db-drizzle";
import { ensureWatcher } from "@/intel/watch-manager";

export const dynamic = "force-dynamic";

// The CLI / ExitPlanMode hook opens the browser here so launching `beacon` in a repo — or an
// agent presenting a plan — lands the browser ON that repo's view. This is the ONE explicit,
// user-facing path allowed to switch the browser's workspace: it sets the global active AND
// the per-browser `beacon_ws` cookie (the durable selection), then redirects into the app.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const redirect = url.searchParams.get("redirect") || "/map";
  const res = NextResponse.redirect(new URL(redirect, url.origin));
  if (id && getWorkspace(id)) {
    // Heal a missing db.sqlite before activating — covers the case where the user
    // wiped a workspace's data, then re-registered it via /beacon-init without ever
    // running `beacon` inside the repo. Without this, the redirect lands on /map and
    // the first query throws SQLITE_CANTOPEN.
    const r = await ensureWorkspaceDb(id);
    if (r.created || r.migrated) invalidateDb(dbUrlFor(id));
    setActiveId(id);
    // Lazily warm a live code-graph watcher for the repo the user just opened, so its
    // blast-radius / files view is fresh even if it wasn't in the boot-time top-N.
    ensureWatcher(id);
    res.cookies.set(BEACON_WS_COOKIE, id, {
      path: "/",
      maxAge: 31536000,
      sameSite: "lax",
    });
  }
  return res;
}
