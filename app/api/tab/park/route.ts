import { runWithWorkspace } from "@/lib/db-drizzle";
import { listWorkspaces, workspaceIdFromRequest } from "@/lib/workspaces";
import { setParkIntent } from "@/lib/nav-intent";

export const dynamic = "force-dynamic";

// POST — asks every LIVE tab of a workspace to park itself: unmount and navigate to a tiny
// static page instead of continuing to hold heavy canvases + an open SSE connection + hydrated
// React. Delivered over the SAME nav-intent channel/seq the CLI's tab-reuse nav uses (see
// lib/nav-intent, app/api/stream) — every tab already listening there picks it up.
//
// `exclude` optionally names ONE tab (by its own self-reported id, see lib/tab-id.ts) that should
// ignore this broadcast — every other tab of the workspace still parks. Useful for a caller that
// knows it's looking at this workspace through a tab it wants to keep alive.
//
// `?all=1` parks every REGISTERED workspace in one call, for a caller that wants to sweep the
// whole install rather than loop workspaces itself.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const exclude = (url.searchParams.get("exclude") ?? "").trim();
  const all = url.searchParams.get("all") === "1";

  if (all) {
    let parked = 0;
    for (const ws of listWorkspaces()) {
      runWithWorkspace(ws.id, () => setParkIntent(exclude));
      parked++;
    }
    return Response.json({ ok: true, workspaces: parked });
  }

  return runWithWorkspace(workspaceIdFromRequest(req), () => {
    const intent = setParkIntent(exclude);
    return Response.json({ ok: true, seq: intent.seq });
  });
}
