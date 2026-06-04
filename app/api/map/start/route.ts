import { startFeature } from "@/lib/map-ops";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (typeof body.title !== "string" || !body.title.trim()) {
      return new Response("title required", { status: 400 });
    }
    const result = await startFeature({
      title: body.title,
      id: typeof body.id === "string" ? body.id : null,
      front: typeof body.front === "string" ? body.front : null,
      detail: typeof body.detail === "string" ? body.detail : null,
    });
    return Response.json(result);
  } catch (e) {
    return new Response(`start failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 500,
    });
  }
}
