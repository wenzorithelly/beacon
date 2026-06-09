import { pinned } from "@/lib/api-workspace";
import { finishFeature } from "@/lib/map-ops";

export const dynamic = "force-dynamic";

export const POST = pinned(async (req: Request) => {
  try {
    const body = await req.json();
    if (typeof body.id !== "string" && (typeof body.title !== "string" || !body.title.trim())) {
      return new Response("title or id required", { status: 400 });
    }
    return Response.json(
      await finishFeature({
        title: typeof body.title === "string" ? body.title : undefined,
        id: typeof body.id === "string" ? body.id : undefined,
      }),
    );
  } catch (e) {
    return new Response(`finish failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 500,
    });
  }
});
