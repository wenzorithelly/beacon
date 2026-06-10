import { createBoardAnnotation, listBoardAnnotations } from "@/lib/board-annotations";
import { pinned } from "@/lib/api-workspace";

export const dynamic = "force-dynamic";

// Persistent /map board annotations. Pinned so the browser reads/writes the workspace it
// is viewing (beacon_ws cookie), never the global active one.
export const GET = pinned(async () => Response.json(await listBoardAnnotations()));

export const POST = pinned(async (req: Request) => {
  try {
    return Response.json(await createBoardAnnotation(await req.json()));
  } catch (e) {
    return new Response(`Invalid annotation: ${e instanceof Error ? e.message : "error"}`, {
      status: 400,
    });
  }
});
