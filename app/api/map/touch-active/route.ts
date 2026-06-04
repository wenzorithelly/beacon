import { getAppSettings } from "@/lib/settings";
import { touchFiles } from "@/lib/map-ops";

export const dynamic = "force-dynamic";

// Attach files to the feature the session is currently working on (set by the most
// recent beacon_start_feature). Called by the auto-report hook on each edit.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const files: string[] = Array.isArray(body.files)
      ? body.files.filter((f: unknown) => typeof f === "string")
      : typeof body.file === "string"
        ? [body.file]
        : [];
    if (!files.length) return new Response("files required", { status: 400 });

    const s = await getAppSettings();
    if (!s.currentFeatureId) return Response.json({ ok: false, reason: "no current feature" });
    return Response.json(await touchFiles({ id: s.currentFeatureId, files }));
  } catch {
    return new Response("invalid", { status: 400 });
  }
}
