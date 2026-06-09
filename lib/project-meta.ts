import { db, type DB } from "@/lib/db-drizzle";
import { projectMeta } from "@/lib/drizzle/schema";

export async function getProjectMeta(prisma: DB = db) {
  const [row] = await prisma
    .insert(projectMeta)
    .values({ id: "singleton" })
    .onConflictDoUpdate({ target: projectMeta.id, set: { id: "singleton" } })
    .returning();
  return row;
}

export async function setProjectMeta(
  data: { overview?: string | null; conventions?: string[] },
  prisma: DB = db,
) {
  // Only the explicitly-provided fields are updated (Prisma `update` with `undefined` =
  // leave unchanged). Drizzle drops `undefined` set-values, but rejects a fully-empty set,
  // so fall back to a PK no-op when nothing was provided.
  const set: { overview?: string | null; conventions?: string; id?: string } = {};
  if (data.overview != null) set.overview = data.overview; // matches Prisma `?? undefined`: null/undefined → unchanged
  if (data.conventions) set.conventions = JSON.stringify(data.conventions);
  if (Object.keys(set).length === 0) set.id = "singleton";
  const [row] = await prisma
    .insert(projectMeta)
    .values({
      id: "singleton",
      overview: data.overview ?? null,
      conventions: JSON.stringify(data.conventions ?? []),
    })
    .onConflictDoUpdate({ target: projectMeta.id, set })
    .returning();
  return row;
}
