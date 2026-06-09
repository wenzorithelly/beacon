import { getVersion } from "@/lib/ingest";
import { runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// Poll fallback for live refresh. Pin to the request's workspace (browser cookie / agent
// header) so a client polls its own workspace's sync counter, not the global active one.
export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    return Response.json({ version: await getVersion() });
  });
}
