import { eq } from "drizzle-orm";
import { db } from "@/lib/db-drizzle";
import { dbTable } from "@/lib/drizzle/schema";
import { bumpVersion } from "@/lib/ingest";
import { pinned } from "@/lib/api-workspace";

export const dynamic = "force-dynamic";

// Delete a real DbTable (DbColumn, DbRelation, EndpointTable rows cascade). A MANUAL table
// stays gone; an INTROSPECTION one reappears on the next code scan. Pinned so the delete
// hits the workspace the browser is viewing, not the global active one.
export const DELETE = pinned(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    try {
      const [deleted] = await db.delete(dbTable).where(eq(dbTable.id, id)).returning();
      if (!deleted) throw new Error("not found");
      await bumpVersion();
      return new Response(null, { status: 204 });
    } catch {
      return new Response("delete failed", { status: 400 });
    }
  },
);
