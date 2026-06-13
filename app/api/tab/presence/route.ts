import { runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";
import { isTabLive } from "@/lib/tab-presence";

export const dynamic = "force-dynamic";

// GET — the `beacon` CLI asks "is a Beacon tab already live for this repo?" (pinned to the
// agent's repo via x-beacon-workspace) so it can REUSE that tab — push a nav-intent the tab
// follows — instead of opening a duplicate browser tab. Presence is recorded server-side by the
// SSE stream tick (lib/tab-presence via app/api/stream); there is no POST beat here, unlike the
// /plan-specific presence which the /plan surface beats from the client.
export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    return Response.json({ live: isTabLive(Date.now()) });
  });
}
