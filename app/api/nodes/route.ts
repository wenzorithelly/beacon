import { createNode } from "@/lib/mutations";
import { createNodeSchema } from "@/lib/schemas";
import { pinned } from "@/lib/api-workspace";

// Create a node and return it. No cache revalidation — the map adds it to local React
// Flow state optimistically so creating never re-renders / reflows the canvas. Pinned so
// the node lands in the workspace the browser is viewing (beacon_ws cookie), not the active.
export const POST = pinned(async (req: Request) => {
  try {
    const node = await createNode(createNodeSchema.parse(await req.json()));
    return Response.json(node);
  } catch (e) {
    return new Response(`Invalid node: ${e instanceof Error ? e.message : "error"}`, {
      status: 400,
    });
  }
});
