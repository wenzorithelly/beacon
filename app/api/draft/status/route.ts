import { runWithWorkspace } from "@/lib/db-drizzle";
import { draftState } from "@/lib/draft-store";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// The /db canvas's own local loop polls this: is the current draft still pending, or has the
// user approved / discarded it? Pinned so it reads the right workspace. (The cross-path
// verdict the propose_plan tool reads now lives in /api/plan/verdict.)
export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => Response.json(draftState()));
}
