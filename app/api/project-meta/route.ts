import { runWithWorkspace } from "@/lib/db-drizzle";
import { getProjectMeta, resolveHasFrontend } from "@/lib/project-meta";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// Workspace-pinned project meta for the MCP process (it's HTTP-only — no db handle), used by
// beacon_propose_plan to pre-check the layer requirement before pushing. `hasFrontend` is the
// RESOLVED value (explicit flag, else code-graph detection); `explicit` is the raw stored flag.
export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    const meta = await getProjectMeta();
    return Response.json({
      hasFrontend: await resolveHasFrontend(),
      explicit: meta.hasFrontend,
    });
  });
}
