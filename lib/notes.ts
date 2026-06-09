import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db-drizzle";
import { note } from "@/lib/drizzle/schema";
import { bumpVersion } from "@/lib/ingest";

// Standalone workspace notes. `body` is GFM markdown — the verbatim text the
// terminal agent reads via the note://{slug} @-mention. Pure data layer
// (validation + db), free of Next imports so it unit-tests directly. Mirrors the
// shape of lib/mutations.ts.

const notePatchSchema = z
  .object({
    title: z.string().max(200),
    body: z.string(),
    pinned: z.boolean(),
    ord: z.number(),
  })
  .partial();

export type NotePatch = z.input<typeof notePatchSchema>;

/** Create an empty note, ordered after every existing one (gap-based ord). */
export async function createNote() {
  const [{ max }] = await db.select({ max: sql<number>`max(${note.ord})` }).from(note);
  const [created] = await db
    .insert(note)
    .values({ ord: (max ?? 0) + 1 })
    .returning();
  await bumpVersion(); // new @-mention resource — signal the MCP server to refetch
  return created;
}

/** Pinned notes first, then most-recently-updated. */
export async function listNotes() {
  return db.query.note.findMany({
    orderBy: (t, { desc }) => [desc(t.pinned), desc(t.updatedAt)],
  });
}

export async function updateNote(id: string, patch: NotePatch) {
  const data = notePatchSchema.parse(patch);
  const [updated] = await db.update(note).set(data).where(eq(note.id, id)).returning();
  // Only a rename changes the @-mention resource (its name + slug); body and pin don't.
  // Body autosaves fire per keystroke, so bumping there would spam live-refresh + refetches.
  if (data.title !== undefined) await bumpVersion();
  return updated;
}

export async function deleteNote(id: string) {
  const [deleted] = await db.delete(note).where(eq(note.id, id)).returning();
  await bumpVersion(); // removed @-mention resource — signal the MCP server to refetch
  return deleted;
}
