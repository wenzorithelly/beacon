import { finishFeature } from "@/lib/map-ops";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (typeof body.title !== "string" || !body.title.trim()) {
      return new Response("title required", { status: 400 });
    }
    return Response.json(await finishFeature(body.title));
  } catch (e) {
    return new Response(`finish failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 500,
    });
  }
}
