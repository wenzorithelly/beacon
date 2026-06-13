import { db, type DB } from "@/lib/db-drizzle";
import { codeFile, projectMeta } from "@/lib/drizzle/schema";
import { detectFrontendFromPaths } from "@/lib/layer";

export async function getProjectMeta(prisma: DB = db) {
  const [row] = await prisma
    .insert(projectMeta)
    .values({ id: "singleton" })
    .onConflictDoUpdate({ target: projectMeta.id, set: { id: "singleton" } })
    .returning();
  return row;
}

export async function setProjectMeta(
  data: {
    overview?: string | null;
    conventions?: string[];
    hasFrontend?: boolean | null;
    classificationRoots?: string[];
  },
  prisma: DB = db,
) {
  // Only the explicitly-provided fields are updated (Prisma `update` with `undefined` =
  // leave unchanged). Drizzle drops `undefined` set-values, but rejects a fully-empty set,
  // so fall back to a PK no-op when nothing was provided.
  const set: {
    overview?: string | null;
    conventions?: string;
    hasFrontend?: boolean | null;
    classificationRoots?: string;
    id?: string;
  } = {};
  if (data.overview != null) set.overview = data.overview; // matches Prisma `?? undefined`: null/undefined → unchanged
  if (data.conventions) set.conventions = JSON.stringify(data.conventions);
  if (data.hasFrontend !== undefined) set.hasFrontend = data.hasFrontend;
  if (data.classificationRoots) set.classificationRoots = JSON.stringify(data.classificationRoots);
  if (Object.keys(set).length === 0) set.id = "singleton";
  const [row] = await prisma
    .insert(projectMeta)
    .values({
      id: "singleton",
      overview: data.overview ?? null,
      conventions: JSON.stringify(data.conventions ?? []),
      hasFrontend: data.hasFrontend ?? null,
      classificationRoots: JSON.stringify(data.classificationRoots ?? []),
    })
    .onConflictDoUpdate({ target: projectMeta.id, set })
    .returning();
  return row;
}

/** Top-level dirs the agent declared at init as where the Files-canvas grouping starts
 *  (ProjectMeta.classificationRoots, JSON-encoded). Empty when undeclared — the canvas then
 *  falls back to adaptive grouping (see lib/file-groups.ts buildGroupKeys). */
export async function resolveClassificationRoots(prisma: DB = db): Promise<string[]> {
  const meta = await getProjectMeta(prisma);
  try {
    const parsed = JSON.parse(meta.classificationRoots ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return [];
  }
}

/** Whether this workspace has a frontend surface — gates the layer (frontend/backend)
 *  distinction everywhere. The agent's explicit answer (ProjectMeta.hasFrontend, set at init)
 *  wins; when unresolved (null), fall back to deterministic detection from the live code
 *  graph: any UI-component file (.tsx/.jsx/.vue/.svelte) means a frontend exists. */
export async function resolveHasFrontend(prisma: DB = db): Promise<boolean> {
  const meta = await getProjectMeta(prisma);
  if (meta.hasFrontend != null) return meta.hasFrontend;
  const files = await prisma.select({ path: codeFile.path }).from(codeFile);
  return detectFrontendFromPaths(files.map((f) => f.path));
}
