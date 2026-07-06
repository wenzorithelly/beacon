import { pinned } from "@/lib/api-workspace";
import { resolveStateMap } from "@/lib/linear/client";
import { getLinearFlag, setLinearFlag } from "@/lib/linear/config";

export const dynamic = "force-dynamic";

// Connection status (never leaks the API key).
export const GET = pinned(async () => {
  const { enabled, config } = await getLinearFlag();
  return Response.json({
    enabled,
    connected: Boolean(config?.apiKey),
    teamId: config?.teamId ?? null,
    teamKey: config?.teamKey ?? null,
    lastCursor: config?.lastCursor ?? null,
  });
});

// Two-step connect: POST { apiKey } saves the key (so /teams can list); POST { teamId } picks the
// team + resolves its workflow states (which also validates the key). POST { enabled } toggles sync.
export const POST = pinned(async (req: Request) => {
  const b = (await req.json().catch(() => ({}))) as {
    apiKey?: string;
    teamId?: string;
    teamKey?: string;
    enabled?: boolean;
  };

  // A new/changed key may be for a different Linear org — clear the team, state map, and cursor so
  // the user re-picks, and pause until they do (otherwise we'd sync org A's team with org B's key).
  if (b.apiKey !== undefined) {
    await setLinearFlag({
      enabled: false,
      config: { apiKey: b.apiKey, teamId: undefined, teamKey: undefined, stateMap: undefined, lastCursor: undefined },
    });
  }

  if (b.teamId) {
    const { config } = await getLinearFlag();
    if (!config?.apiKey) return Response.json({ error: "Paste an API key first" }, { status: 400 });
    try {
      const stateMap = await resolveStateMap(config.apiKey, b.teamId);
      await setLinearFlag({ config: { teamId: b.teamId, teamKey: b.teamKey, stateMap } });
    } catch {
      return Response.json({ error: "Linear rejected the key or team" }, { status: 400 });
    }
  }

  if (b.enabled !== undefined) await setLinearFlag({ enabled: b.enabled });

  const { enabled, config } = await getLinearFlag();
  return Response.json({
    enabled,
    connected: Boolean(config?.apiKey),
    teamId: config?.teamId ?? null,
    teamKey: config?.teamKey ?? null,
    lastCursor: config?.lastCursor ?? null,
  });
});
