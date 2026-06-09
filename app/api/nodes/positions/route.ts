import { z } from "zod";
import { pinned } from "@/lib/api-workspace";
import { updateNodePositions } from "@/lib/mutations";

// Batch position persistence for the roadmap "Arrange" action: the client computes group-by
// lane positions for every feature and saves them in ONE round-trip. Static sibling of
// `nodes/[id]` (like `nodes/subtasks`), so `/api/nodes/positions` resolves here, not to the
// dynamic `[id]` route. No cache revalidation — positions don't change rendered data, and the
// canvas already applied them optimistically. Pinned to the workspace the browser is viewing.
const row = z.object({ id: z.string().min(1), x: z.number(), y: z.number() });
const schema = z.object({ batch: z.array(row).min(1) });

export const POST = pinned(async (req: Request) => {
  try {
    const { batch } = schema.parse(await req.json());
    const updated = await updateNodePositions(batch);
    return Response.json({ ok: true, updated });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "error", { status: 400 });
  }
});
