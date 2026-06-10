import { deleteBugFlag, updateBugFlag } from "@/lib/bug-flags";
import { pinned } from "@/lib/api-workspace";

// Edit a flag's note or resolve/reopen it ({ resolved: boolean }); plus delete.
// Validation lives in lib/bug-flags (Zod), so a bad patch returns 400.
export const PATCH = pinned(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    try {
      return Response.json(await updateBugFlag(id, await req.json()));
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
      await deleteBugFlag(id);
      return new Response(null, { status: 204 });
    } catch {
      return new Response("delete failed", { status: 400 });
    }
  },
);
