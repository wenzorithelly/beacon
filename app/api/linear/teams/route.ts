import { pinned } from "@/lib/api-workspace";
import { listTeams } from "@/lib/linear/client";
import { getLinearFlag } from "@/lib/linear/config";

export const dynamic = "force-dynamic";

// Teams for the settings picker — uses the saved key (POST { apiKey } first).
export const GET = pinned(async () => {
  const { config } = await getLinearFlag();
  if (!config?.apiKey) return Response.json({ teams: [] });
  try {
    return Response.json({ teams: await listTeams(config.apiKey) });
  } catch {
    return Response.json({ teams: [], error: "Linear rejected the key" }, { status: 400 });
  }
});
