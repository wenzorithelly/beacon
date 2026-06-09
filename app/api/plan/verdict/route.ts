import { runWithWorkspace } from "@/lib/db-drizzle";
import { resolvePlanVerdict } from "@/lib/plan-resolve";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// The single verdict source both pollers read — the beacon_propose_plan MCP tool AND the
// ExitPlanMode hook (bin/plan.ts). Pinned so the poll reads the agent's repo's plan state,
// not whatever the browser has selected. Collapses the old 3-endpoint poll (/api/plan +
// /api/plan/annotations + /api/draft/status) into one coherent answer.
export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () =>
    Response.json(await resolvePlanVerdict()),
  );
}
