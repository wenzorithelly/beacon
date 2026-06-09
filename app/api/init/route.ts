import { runInitFromAnalysis } from "@/lib/init";
import { runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";

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
    const wsId = workspaceIdFromRequest(req);
    const result = await runWithWorkspace(wsId, () => runInitFromAnalysis(body));
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return new Response(`Invalid init payload: ${msg}`, { status: 400 });
  }
}
