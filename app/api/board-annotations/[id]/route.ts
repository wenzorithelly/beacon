import { deleteBoardAnnotation, updateBoardAnnotation } from "@/lib/board-annotations";
import { pinned } from "@/lib/api-workspace";

// Edit an annotation's text or remember where the user parked the card; plus delete.
// Validation lives in lib/board-annotations (Zod), so a bad patch returns 400.
export const PATCH = pinned(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    try {
      return Response.json(await updateBoardAnnotation(id, await req.json()));
    } catch (e) {
      return new Response(`Invalid edit: ${e instanceof Error ? e.message : "error"}`, {
        status: 400,
      });
    }
  },
);

export const DELETE = pinned(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    try {
      await deleteBoardAnnotation(id);
      return new Response(null, { status: 204 });
    } catch {
      return new Response("delete failed", { status: 400 });
    }
  },
);
