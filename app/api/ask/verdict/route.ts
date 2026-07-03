import { runWithWorkspace } from "@/lib/db-drizzle";
import { readAskResolution } from "@/lib/ask-store";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// The `beacon ask` hook long-polls this for the user's answer to the ask it pushed. It passes the
// ask id it created; we only return a resolution whose id matches, so a stale resolution from an
// earlier ask never leaks to the wrong hook. Pinned to the agent's repo like the plan verdict.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    const r = readAskResolution();
    if (r && r.id === id) return Response.json({ status: "resolved", resolution: r });
    return Response.json({ status: "pending" });
  });
}
