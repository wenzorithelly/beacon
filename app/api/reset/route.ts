import { resetAllData } from "@/lib/reset";
import { pinned } from "@/lib/api-workspace";

export const dynamic = "force-dynamic";

// Destructive: wipes all project data (graph, DB map, drafts, code graph, project meta).
// Triggered from the red button in Settings. Keeps provider/editor prefs. Pinned so it
// wipes the workspace the browser is viewing (beacon_ws cookie), NOT whatever a background
// agent left as the global active — a reset hitting the wrong repo would be unrecoverable.
export const POST = pinned(async () => {
  try {
    await resetAllData();
    return Response.json({ ok: true });
  } catch (e) {
    return new Response(`reset failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 500,
    });
  }
});
