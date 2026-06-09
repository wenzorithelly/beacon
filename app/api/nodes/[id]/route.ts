import { deleteNode, updateNode } from "@/lib/mutations";
import { updateNodeSchema } from "@/lib/schemas";
import { pinned } from "@/lib/api-workspace";

// Inline node edits (title / category / status / role / desc / priority). Like the
// position route: writes the fields and returns 204 with NO revalidation, so editing
// on the canvas stays local + smooth (the map updates its own state optimistically).
// Pinned so edits hit the workspace the browser is viewing, not the global active one.
export const PATCH = pinned(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    try {
      await updateNode(id, updateNodeSchema.parse(await req.json()));
      return new Response(null, { status: 204 });
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
      await deleteNode(id);
      return new Response(null, { status: 204 });
    } catch {
      return new Response("delete failed", { status: 400 });
    }
  },
);
