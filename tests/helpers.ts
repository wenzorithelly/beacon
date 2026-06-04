import { db } from "@/lib/db";

/** Clears all tables in FK-safe order. Used by data-mutating test suites. */
export async function resetDb() {
  await db.bug.deleteMany();
  await db.edge.deleteMany();
  await db.note.deleteMany();
  await db.node.deleteMany();
  await db.tag.deleteMany();
}
