import { createEdge } from "@/lib/mutations";
import { pinned } from "@/lib/api-workspace";

export const dynamic = "force-dynamic";

// Create a roadmap dependency edge (or RELATES/REPLACES) from dragging between two node
// handles on /map. Like /api/nodes: no cache revalidation — the map appends to its own
// React Flow state optimistically, so creating never re-renders the canvas. Pinned so the
// edge lands in the workspace the browser is viewing, not the global active one.
export const POST = pinned(async (req: Request) => {
  try {
    const edge = await createEdge(await req.json());
    return Response.json(edge);
  } catch (e) {
    return new Response(`Invalid edge: ${e instanceof Error ? e.message : "error"}`, {
      status: 400,
    });
  }
});
