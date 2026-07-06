import { pinned } from "@/lib/api-workspace";
import { resolveViewerAndOrg } from "@/lib/linear/client";
import { getLinearFlag, setLinearFlag } from "@/lib/linear/config";
import type { LinearScope } from "@/lib/linear/types";

export const dynamic = "force-dynamic";

// Connection status (never leaks the API key).
export const GET = pinned(async () => {
  const { enabled, config } = await getLinearFlag();
  return Response.json({
    enabled,
    connected: Boolean(config?.apiKey),
    orgName: config?.orgName ?? null,
    viewerName: config?.viewerName ?? null,
    scope: config?.scope ?? null,
    onlyMine: config?.onlyMine ?? false,
    lastSyncedAt: config?.lastSyncedAt ?? null,
  });
});

// POST { apiKey } connects (resolves the viewer + workspace, resets scope). POST { scope } picks the
// team/project. POST { onlyMine } / { enabled } toggle.
export const POST = pinned(async (req: Request) => {
  const b = (await req.json().catch(() => ({}))) as {
    apiKey?: string;
    scope?: LinearScope | null;
    onlyMine?: boolean;
    enabled?: boolean;
  };

  if (b.apiKey !== undefined) {
    // A new key may be a different workspace — resolve who/where it is (also validates the key) and
    // reset everything scope-related so the user re-picks.
    try {
      const vo = await resolveViewerAndOrg(b.apiKey);
      await setLinearFlag({
        enabled: false,
        config: {
          apiKey: b.apiKey,
          viewerId: vo.viewerId,
          viewerName: vo.viewerName,
          orgName: vo.orgName,
          orgUrlKey: vo.orgUrlKey,
          scope: undefined,
          onlyMine: undefined,
          stateMapByTeam: undefined,
          lastSyncedAt: undefined,
        },
      });
    } catch {
      return Response.json({ error: "Linear rejected the key" }, { status: 400 });
    }
  }

  if (b.scope !== undefined) await setLinearFlag({ config: { scope: b.scope ?? undefined } });
  if (b.onlyMine !== undefined) await setLinearFlag({ config: { onlyMine: b.onlyMine } });
  if (b.enabled !== undefined) await setLinearFlag({ enabled: b.enabled });

  const { enabled, config } = await getLinearFlag();
  return Response.json({
    enabled,
    connected: Boolean(config?.apiKey),
    orgName: config?.orgName ?? null,
    viewerName: config?.viewerName ?? null,
    scope: config?.scope ?? null,
    onlyMine: config?.onlyMine ?? false,
    lastSyncedAt: config?.lastSyncedAt ?? null,
  });
});
