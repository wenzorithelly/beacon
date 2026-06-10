import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db-drizzle";
import { boardAnnotation } from "@/lib/drizzle/schema";
import { bumpVersion } from "@/lib/ingest";

// Persistent board annotations: notes pinned to a /map board entity, kept across sessions.
// Pure data layer (Zod + db, no Next imports) so it unit-tests directly — mirrors lib/notes.ts.
// Created empty (the user types into the card), so `body` only arrives via update.

const createSchema = z
  .object({
    targetKind: z.union([
      z.literal("feature"),
      z.literal("table"),
      z.literal("column"),
      z.literal("endpoint"),
    ]),
    targetId: z.string().min(1),
    columnName: z.string().min(1).optional(),
  })
  .refine((v) => v.targetKind !== "column" || !!v.columnName, {
    message: "columnName is required when targetKind is column",
  });

const patchSchema = z
  .object({
    body: z.string().max(2000),
    x: z.number(),
    y: z.number(),
  })
  .partial();

export type BoardAnnotationCreate = z.input<typeof createSchema>;
export type BoardAnnotationPatch = z.input<typeof patchSchema>;
export type BoardAnnotationRow = typeof boardAnnotation.$inferSelect;

export async function createBoardAnnotation(input: BoardAnnotationCreate) {
  const data = createSchema.parse(input);
  const [created] = await db.insert(boardAnnotation).values(data).returning();
  await bumpVersion(); // other open canvases pick the new pin up via live-refresh
  return created;
}

/** Oldest-first (id tiebreak for same-ms creates) so pin numbers stay stable across reloads. */
export async function listBoardAnnotations() {
  return db.query.boardAnnotation.findMany({
    orderBy: (t, { asc }) => [asc(t.createdAt), asc(t.id)],
  });
}

export async function updateBoardAnnotation(id: string, patch: BoardAnnotationPatch) {
  const data = patchSchema.parse(patch);
  const [updated] = await db
    .update(boardAnnotation)
    .set(data)
    .where(eq(boardAnnotation.id, id))
    .returning();
  // No bumpVersion: text/position edits are already on the editing user's screen, and
  // per-blur bumps would churn live-refresh for everyone else over cosmetic moves.
  return updated;
}

export async function deleteBoardAnnotation(id: string) {
  const [deleted] = await db.delete(boardAnnotation).where(eq(boardAnnotation.id, id)).returning();
  await bumpVersion();
  return deleted;
}
