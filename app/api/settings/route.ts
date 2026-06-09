import { getAppSettings } from "@/lib/settings";
import { pinned } from "@/lib/api-workspace";

export const dynamic = "force-dynamic";

// Read-only: the intel watcher/pipeline pulls the model + provider from here each
// run (see intel/settings.ts → fetchSettings). Pinned so it reflects the workspace the
// caller is scoped to (browser cookie / agent header), not the global active one.
export const GET = pinned(async () => {
  const s = await getAppSettings();
  return Response.json({
    intelModel: s.intelModel,
    intelProvider: s.intelProvider,
  });
});
