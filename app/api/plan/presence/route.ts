import { runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";
import { recordPlanPresence, isPlanTabLive } from "@/lib/plan-presence";

export const dynamic = "force-dynamic";

// POST — the open /plan surface heartbeats here while mounted, pinned to the workspace it's
// viewing (browser `beacon_ws` cookie). GET — the ExitPlanMode hook asks "is a /plan tab
// already live for this repo?" (pinned to the agent's repo via x-beacon-workspace) so it can
// let that tab refresh the revised plan in place instead of opening a duplicate browser tab.

export async function POST(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    recordPlanPresence(Date.now());
    return Response.json({ ok: true });
  });
}

export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    return Response.json({ live: isPlanTabLive(Date.now()) });
  });
}
