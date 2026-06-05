import { createNode } from "@/lib/mutations";
import { createNodeSchema } from "@/lib/schemas";

// Create a node and return it. No cache revalidation — the map adds it to local React
// Flow state optimistically so creating never re-renders / reflows the canvas.
export async function POST(req: Request) {
  try {
    const node = await createNode(createNodeSchema.parse(await req.json()));
    return Response.json(node);
  } catch (e) {
    return new Response(`Invalid node: ${e instanceof Error ? e.message : "error"}`, {
      status: 400,
    });
  }
}
