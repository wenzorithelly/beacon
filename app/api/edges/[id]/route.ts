import { eq } from "drizzle-orm";
import { db } from "@/lib/db-drizzle";
import { edge } from "@/lib/drizzle/schema";
import { pinned } from "@/lib/api-workspace";

// Remove a user-drawn dependency edge (DEPENDS / RELATES / REPLACES). Containment edges
// are derived from Node.parentId and can't be deleted via this route — re-parent the
// node instead. Pinned so the delete hits the workspace the browser is viewing.
export const DELETE = pinned(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    try {
      const [deleted] = await db.delete(edge).where(eq(edge.id, id)).returning();
      if (!deleted) throw new Error("not found");
      return new Response(null, { status: 204 });
    } catch (e) {
      return new Response(`Edge not found: ${e instanceof Error ? e.message : "error"}`, {
        status: 404,
      });
    }
  },
);
