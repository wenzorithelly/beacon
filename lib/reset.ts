import { db, type DB } from "@/lib/db-drizzle";
import {
  appSetting,
  dbColumn,
  dbRelation,
  dbTable,
  draftColumn,
  draftRelation,
  draftTable,
  edge,
  endpoint,
  endpointTable,
  node,
  nodeFile,
  note,
  projectMeta,
  tag,
} from "@/lib/drizzle/schema";
import { bumpVersion } from "@/lib/ingest";
import { purgeDraft } from "@/lib/draft-store";

// Wipes every piece of project data so the panel starts from zero: the roadmap/
// architecture graph, the DB map, drafts, the code graph and the derived project
// overview. Deletes children before parents (FK-safe). Keeps the user's
// provider/editor preferences in AppSetting, just drops the dangling feature pointer.
export async function resetAllData(prisma: DB = db): Promise<void> {
  // DB map (introspected schema)
  await prisma.delete(endpointTable);
  await prisma.delete(endpoint);
  await prisma.delete(dbRelation);
  await prisma.delete(dbColumn);
  await prisma.delete(dbTable);

  // DB designer drafts: legacy DB rows + the current JSON draft/verdict files
  await prisma.delete(draftRelation);
  await prisma.delete(draftColumn);
  await prisma.delete(draftTable);
  purgeDraft();

  // Roadmap / architecture graph (NodeFile cascades from Node)
  await prisma.delete(edge);
  await prisma.delete(note);
  await prisma.delete(nodeFile);
  await prisma.delete(node);
  await prisma.delete(tag);

  // Derived project meta
  await prisma.delete(projectMeta);

  // Keep provider/editor prefs; clear the now-dangling "current feature" pointer.
  await prisma.update(appSetting).set({ currentFeatureId: null });

  await bumpVersion(prisma); // nudge the live SSE refresh so open views go empty
}
