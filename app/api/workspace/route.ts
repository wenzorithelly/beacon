import {
  BEACON_WS_COOKIE,
  dbUrlFor,
  ensureWorkspaceDb,
  getActiveId,
  getWorkspace,
  listWorkspaces,
  setActiveId,
  workspaceIdFromRequest,
} from "@/lib/workspaces";
import { invalidateDb } from "@/lib/db-drizzle";
import { deleteWorkspace } from "@/lib/workspace-delete";

export const dynamic = "force-dynamic";

// List the registered workspaces + which one THIS browser is on (for the nav switcher).
// The browser's selection lives in the `beacon_ws` cookie and wins over the global active
// file, so the dropdown stays put even when a background agent flips the active workspace.
export async function GET(req: Request) {
  return Response.json({
    workspaces: listWorkspaces(),
    active: workspaceIdFromRequest(req) ?? getActiveId(),
  });
}

// Switch the workspace from the dropdown. Persists the choice in a per-browser cookie (the
// durable selection) AND updates the global active (the fallback for fresh tabs / the CLI).
export async function POST(req: Request) {
  const { id } = await req.json();
  if (typeof id !== "string" || !id) return new Response("id required", { status: 400 });
  if (!getWorkspace(id)) return new Response("unknown workspace", { status: 404 });
  // Heal a missing db.sqlite before activating — see app/api/workspace/activate
  // for the same self-heal in the CLI's GET path. Without this, the dropdown can
  // hand the user a workspace whose first query throws SQLITE_CANTOPEN.
  const r = await ensureWorkspaceDb(id);
  if (!r.ok) return Response.json({ ok: false, error: r.error }, { status: 500 });
  if (r.created || r.migrated) invalidateDb(dbUrlFor(id));
  setActiveId(id);
  const res = Response.json({ ok: true, healed: r.created || r.migrated });
  // 1-year cookie; Lax so it rides same-origin navigations (the CLI's activate redirect).
  res.headers.set(
    "set-cookie",
    `${BEACON_WS_COOKIE}=${id}; Path=/; Max-Age=31536000; SameSite=Lax`,
  );
  return res;
}

// Delete a workspace for good: unregister, stop its watcher, close its client, wipe
// ~/.beacon/<id>/ (the repo's files are untouched). Repoints the browser onto the
// fallback workspace — or expires the cookie when none remain.
export async function DELETE(req: Request) {
  const { id } = await req.json();
  if (typeof id !== "string" || !id) return new Response("id required", { status: 400 });
  const r = await deleteWorkspace(id);
  if (!r.removed) return new Response("unknown workspace", { status: 404 });
  if (!r.ok) return Response.json({ ok: false, error: r.error }, { status: 500 });
  // Heal the fallback before the browser refreshes onto it (same self-heal as POST).
  if (r.fallbackId) {
    const h = await ensureWorkspaceDb(r.fallbackId);
    if (h.created || h.migrated) invalidateDb(dbUrlFor(r.fallbackId));
  }
  const res = Response.json({ ok: true, fallbackId: r.fallbackId });
  // Always repoint: the settings card only deletes the workspace this browser is viewing.
  res.headers.set(
    "set-cookie",
    r.fallbackId
      ? `${BEACON_WS_COOKIE}=${r.fallbackId}; Path=/; Max-Age=31536000; SameSite=Lax`
      : `${BEACON_WS_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`,
  );
  return res;
}
