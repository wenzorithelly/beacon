import { runInitFromAnalysis } from "@/lib/init";
import { runWithWorkspace } from "@/lib/db-drizzle";
import {
  BEACON_WS_PATH_HEADER,
  ensureWorkspaceDb,
  isRegistrableWorkspacePath,
  registerWorkspaceExplicit,
  workspaceIdFromRequest,
} from "@/lib/workspaces";

// The /beacon-init Claude Code skill POSTs the analysis the user's session
// produced to this endpoint. Architecture nodes + roadmap fronts + project
// meta land in the workspace DB; AGENTS.md / CLAUDE.md get regenerated.
//
// Pinned to the requesting repo's workspace via runWithWorkspace: the agent's
// session runs in a specific repo (the MCP server sends x-beacon-workspace), so
// BOTH the DB writes and the AGENTS.md path follow that repo — never whatever the
// browser dropdown has active. This is what prevents a /beacon-init in repo A from
// landing in repo B's database.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    // /beacon-init is the EXPLICIT opt-in: register the requesting repo (clearing any deletion
    // tombstone) so re-running it after a delete brings the workspace back. The MCP server sends
    // the repo path on this header; fall back to the id/cookie resolver when it's absent.
    const headerPath = req.headers.get(BEACON_WS_PATH_HEADER);
    let wsId: string | null;
    if (headerPath && isRegistrableWorkspacePath(headerPath)) {
      const ws = registerWorkspaceExplicit(headerPath);
      await ensureWorkspaceDb(ws.id);
      wsId = ws.id;
    } else {
      wsId = workspaceIdFromRequest(req);
    }
    const result = await runWithWorkspace(wsId, () => runInitFromAnalysis(body));
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return new Response(`Invalid init payload: ${msg}`, { status: 400 });
  }
}
