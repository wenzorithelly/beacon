import { deleteNote, updateNote } from "@/lib/notes";
import { pinned } from "@/lib/api-workspace";

// Debounced autosave of title / body / pinned / ord from the editor, plus delete.
// Validation lives in lib/notes (Zod), so a bad patch returns 400. Pinned so writes
// hit the workspace the browser is viewing.
export const PATCH = pinned(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    try {
      return Response.json(await updateNote(id, await req.json()));
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
      await deleteNote(id);
      return new Response(null, { status: 204 });
    } catch {
      return new Response("delete failed", { status: 400 });
    }
  },
);
