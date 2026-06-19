import { runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";
import { isLessonTabLive, recordLessonPresence } from "@/lib/lesson-presence";

export const dynamic = "force-dynamic";

// POST — the open /learn surface heartbeats here while mounted (browser beacon_ws cookie).
// GET — the beacon_explain tool asks "is a /learn tab already live for this repo?" before opening
// the browser, so a re-pushed lesson refreshes in place instead of spawning a duplicate tab.

export async function POST(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    recordLessonPresence(Date.now());
    return Response.json({ ok: true });
  });
}

export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () =>
    Response.json({ live: isLessonTabLive(Date.now()) }),
  );
}
