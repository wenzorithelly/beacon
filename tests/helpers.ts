import { db } from "@/lib/db";
import { boardAnnotation, edge, note, node, tag } from "@/lib/drizzle/schema";

/** Clears all tables in FK-safe order. Used by data-mutating test suites. */
export async function resetDb() {
  await db.delete(boardAnnotation);
  await db.delete(edge);
  await db.delete(note);
  await db.delete(node);
  await db.delete(tag);
}
