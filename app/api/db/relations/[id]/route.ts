import { eq } from "drizzle-orm";
import { db } from "@/lib/db-drizzle";
import { dbRelation } from "@/lib/drizzle/schema";
import { bumpVersion } from "@/lib/ingest";
import { pinned } from "@/lib/api-workspace";

export const dynamic = "force-dynamic";

// Delete a FK relation between two DbTables. Manual relations stay gone; introspected
// ones reappear on the next code scan if the FK is still in the source. Pinned so the
// delete hits the workspace the browser is viewing.
export const DELETE = pinned(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    try {
      const [deleted] = await db.delete(dbRelation).where(eq(dbRelation.id, id)).returning();
      if (!deleted) throw new Error("not found");
      await bumpVersion();
      return new Response(null, { status: 204 });
    } catch {
      return new Response("delete failed", { status: 400 });
    }
  },
);
