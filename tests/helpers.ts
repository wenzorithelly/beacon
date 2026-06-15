import { db } from "@/lib/db";
import {
  boardAnnotation,
  bugFlag,
  edge,
  note,
  node,
  planContract,
  tag,
  workspaceFlag,
} from "@/lib/drizzle/schema";

/** Clears all tables in FK-safe order. Used by data-mutating test suites. */
export async function resetDb() {
  await db.delete(boardAnnotation);
  await db.delete(bugFlag);
  await db.delete(edge);
  await db.delete(note);
  await db.delete(node);
  await db.delete(tag);
  await db.delete(planContract);
  await db.delete(workspaceFlag);
}
