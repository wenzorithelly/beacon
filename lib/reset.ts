import { db } from "@/lib/db";
import { bumpVersion } from "@/lib/ingest";

type Prisma = typeof db;

// Wipes every piece of project data so the panel starts from zero: the roadmap/
// architecture graph, bugs, the DB map, drafts, integrations and the derived
// project overview. Deletes children before parents (FK-safe). Keeps the user's
// provider/editor preferences in AppSetting, just drops the dangling feature pointer.
export async function resetAllData(prisma: Prisma = db): Promise<void> {
  // DB map (introspected schema)
  await prisma.endpointTable.deleteMany();
  await prisma.endpoint.deleteMany();
  await prisma.dbRelation.deleteMany();
  await prisma.dbColumn.deleteMany();
  await prisma.dbTable.deleteMany();

  // DB designer drafts
  await prisma.draftRelation.deleteMany();
  await prisma.draftColumn.deleteMany();
  await prisma.draftTable.deleteMany();

  // Roadmap / architecture graph (NodeFile cascades from Node)
  await prisma.bug.deleteMany();
  await prisma.edge.deleteMany();
  await prisma.note.deleteMany();
  await prisma.nodeFile.deleteMany();
  await prisma.node.deleteMany();
  await prisma.tag.deleteMany();

  // Integrations + derived project meta
  await prisma.integration.deleteMany();
  await prisma.projectMeta.deleteMany();

  // Keep provider/editor prefs; clear the now-dangling "current feature" pointer.
  await prisma.appSetting.updateMany({ data: { currentFeatureId: null } });

  await bumpVersion(prisma); // nudge the live SSE refresh so open views go empty
}
