import { pinned } from "@/lib/api-workspace";
import { touchFiles } from "@/lib/map-ops";

export const dynamic = "force-dynamic";

export const POST = pinned(async (req: Request) => {
  try {
    const body = await req.json();
    if (!Array.isArray(body.files)) {
      return new Response("files[] required", { status: 400 });
    }
    const files = body.files.filter((f: unknown) => typeof f === "string") as string[];
    return Response.json(
      await touchFiles({
        id: typeof body.id === "string" ? body.id : undefined,
        title: typeof body.title === "string" ? body.title : undefined,
        files,
      }),
    );
  } catch (e) {
    return new Response(`files failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 500,
    });
  }
});
