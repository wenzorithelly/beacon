import { pinned } from "@/lib/api-workspace";
import { listScopes } from "@/lib/linear/client";
import { getLinearFlag } from "@/lib/linear/config";

export const dynamic = "force-dynamic";

// Teams + projects + milestones (each carrying `projectName`) in the connected workspace, for the
// multi-scope picker (uses the saved key).
export const GET = pinned(async () => {
  const { config } = await getLinearFlag();
  if (!config?.apiKey) return Response.json({ scopes: [] });
  try {
    return Response.json({ scopes: await listScopes(config.apiKey) });
  } catch {
    return Response.json({ scopes: [], error: "Linear rejected the key" }, { status: 400 });
  }
});
