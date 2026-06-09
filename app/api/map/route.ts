import { listMap } from "@/lib/map-ops";
import { runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () =>
    Response.json(await listMap()),
  );
}
