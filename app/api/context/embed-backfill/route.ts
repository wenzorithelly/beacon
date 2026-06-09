import { eq } from "drizzle-orm";
import { pinned } from "@/lib/api-workspace";
import { db } from "@/lib/db-drizzle";
import { node as nodeTable } from "@/lib/drizzle/schema";
import { embedText, encodeVector, nodeEmbeddingInput } from "@/lib/embeddings";

// One-shot backfill: embed every Node whose `embedding` is still null. Safe to
// call repeatedly (re-runs only the unembedded rows). Used once after migration
// to seed semantic search for pre-existing data; the write paths handle new rows.
export const POST = pinned(async () => {
  const rows = await db.query.node.findMany({
    where: (t, { isNull: isNullf }) => isNullf(t.embedding),
    columns: { id: true, title: true, role: true, plain: true, cluster: true },
  });

  let embedded = 0;
  let failed = 0;
  for (const node of rows) {
    const vec = await embedText(nodeEmbeddingInput(node));
    if (!vec) {
      failed++;
      continue;
    }
    await db.update(nodeTable).set({ embedding: encodeVector(vec) }).where(eq(nodeTable.id, node.id));
    embedded++;
  }

  return Response.json({ ok: true, scanned: rows.length, embedded, failed });
});
