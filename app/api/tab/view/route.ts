import { runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";
import { isViewLive, recordViewPresence } from "@/lib/view-presence";

export const dynamic = "force-dynamic";

// The FOCUSED-view presence for a repo. POST — the browser (components/live-refresh) beats this
// every few seconds ONLY while its Beacon tab is visible AND focused (the user is actually looking
// at it). GET — the agent-ask bridge (bin/ask.ts) asks "is the user on Beacon right now?" to decide
// between surfacing a question in the modal vs falling through to the terminal. Distinct from
// /api/tab/presence, which stays live for a backgrounded tab (that's for the CLI's tab-reuse).
export async function POST(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    recordViewPresence(Date.now());
    return Response.json({ ok: true });
  });
}

export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    return Response.json({ live: isViewLive(Date.now()) });
  });
}
