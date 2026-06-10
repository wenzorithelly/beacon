import { createBugFlag, listBugFlags } from "@/lib/bug-flags";
import { pinned } from "@/lib/api-workspace";

export const dynamic = "force-dynamic";

// Bug flags on map nodes. Pinned so the browser reads/writes the workspace it is
// viewing (beacon_ws cookie), never the global active one.
export const GET = pinned(async (req: Request) => {
  const url = new URL(req.url);
  const nodeId = url.searchParams.get("nodeId") ?? undefined;
  const open = url.searchParams.get("open") === "1" || undefined;
  return Response.json(await listBugFlags({ nodeId, open }));
});

export const POST = pinned(async (req: Request) => {
  try {
    return Response.json(await createBugFlag(await req.json()));
  } catch (e) {
    return new Response(`Invalid bug flag: ${e instanceof Error ? e.message : "error"}`, {
      status: 400,
    });
  }
});
