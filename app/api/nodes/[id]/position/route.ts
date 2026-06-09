import { updateNodePosition } from "@/lib/mutations";
import { pinned } from "@/lib/api-workspace";

// Lightweight, high-frequency endpoint for drag persistence. Writes x/y only and
// returns 204 with no cache revalidation (positions don't change rendered data).
// Pinned so the drag persists into the workspace the browser is viewing.
export const POST = pinned(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    try {
      const { x, y } = await req.json();
      await updateNodePosition(id, x, y);
      return new Response(null, { status: 204 });
    } catch {
      return new Response("Invalid position", { status: 400 });
    }
  },
);
