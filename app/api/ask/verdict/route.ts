import { runWithWorkspace } from "@/lib/db-drizzle";
import { readAskResolutionById } from "@/lib/ask-store";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// The `beacon ask` hook long-polls this for the user's answer to the ask it pushed. It passes the
// ask id it created; we look the resolution up BY that id, so a stale resolution from an earlier ask
// never leaks to the wrong hook — and, with several sessions blocked at once, one hook's verdict is
// never hidden by another's landing after it. Pinned to the agent's repo like the plan verdict.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    const r = readAskResolutionById(id);
    if (r) return Response.json({ status: "resolved", resolution: r });
    return Response.json({ status: "pending" });
  });
}
