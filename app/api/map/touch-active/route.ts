import { pinned } from "@/lib/api-workspace";
import { getAppSettings } from "@/lib/settings";
import { touchFiles } from "@/lib/map-ops";
import { recordTouched } from "@/lib/touched-files";
import { bumpVersion } from "@/lib/ingest";

export const dynamic = "force-dynamic";

// Attach files to the feature the session is currently working on (set by the most
// recent beacon_start_feature). Called by the auto-report hook on each edit. Also records
// the edit into the touched-files store (independent of any active feature) so the Files
// canvas can light up what the agent is touching live.
export const POST = pinned(async (req: Request) => {
  try {
    const body = await req.json();
    const files: string[] = Array.isArray(body.files)
      ? body.files.filter((f: unknown) => typeof f === "string")
      : typeof body.file === "string"
        ? [body.file]
        : [];
    if (!files.length) return new Response("files required", { status: 400 });

    // Touched-Files overlay: record every edited path with an updated count + timestamp.
    recordTouched(files, Date.now());

    const s = await getAppSettings();
    if (s.currentFeatureId) {
      // touchFiles bumps the sync version itself, which refreshes the open canvases.
      return Response.json({ ...(await touchFiles({ id: s.currentFeatureId, files })), touched: files.length });
    }
    // No active feature — still bump so the Files overlay refreshes from the touched store.
    await bumpVersion();
    return Response.json({ ok: true, touched: files.length, reason: "no current feature" });
  } catch {
    return new Response("invalid", { status: 400 });
  }
});
