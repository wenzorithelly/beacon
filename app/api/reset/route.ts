import { resetAllData } from "@/lib/reset";

export const dynamic = "force-dynamic";

// Destructive: wipes all project data (graph, bugs, DB map, drafts, integrations,
// project meta). Triggered from the red button in Config. Keeps provider/editor prefs.
export async function POST() {
  try {
    await resetAllData();
    return Response.json({ ok: true });
  } catch (e) {
    return new Response(`reset failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 500,
    });
  }
}
