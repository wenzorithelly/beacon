import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db-drizzle";
import { bugFlag } from "@/lib/drizzle/schema";
import { bumpVersion } from "@/lib/ingest";
import { BUG_FLAG_BY } from "@/lib/schemas";

// Bug/investigation flags on nodes (architecture components today). Pure data layer
// (Zod + db, no Next imports) so it unit-tests directly — mirrors lib/board-annotations.ts.
// The sidebar creates by="user"; agent paths (init/refresh/describe) create by="agent".

const createSchema = z.object({
  nodeId: z.string().min(1),
  by: BUG_FLAG_BY,
  note: z.string().trim().min(1).max(2000),
});

const patchSchema = z
  .object({
    note: z.string().trim().min(1).max(2000),
    resolved: z.boolean(),
  })
  .partial();

export type BugFlagCreate = z.input<typeof createSchema>;
export type BugFlagPatch = z.input<typeof patchSchema>;
export type BugFlagRow = typeof bugFlag.$inferSelect;

export async function createBugFlag(input: BugFlagCreate) {
  const data = createSchema.parse(input);
  // Verify the target node exists up front — libSQL reports a missing FK as a generic
  // constraint error, this keeps the 400 message meaningful.
  const target = await db.query.node.findFirst({
    where: (t, { eq }) => eq(t.id, data.nodeId),
    columns: { id: true },
  });
  if (!target) throw new Error(`node ${data.nodeId} not found`);
  const [created] = await db.insert(bugFlag).values(data).returning();
  await bumpVersion(); // card badges on other open canvases update via live-refresh
  return created;
}

/** Oldest-first so the sidebar list keeps a stable order across reloads. */
export async function listBugFlags(filter?: { nodeId?: string; open?: boolean }) {
  const conds = [
    ...(filter?.nodeId ? [eq(bugFlag.nodeId, filter.nodeId)] : []),
    ...(filter?.open ? [isNull(bugFlag.resolvedAt)] : []),
  ];
  return db.query.bugFlag.findMany({
    where: conds.length ? and(...conds) : undefined,
    orderBy: (t, { asc }) => [asc(t.createdAt), asc(t.id)],
  });
}

export async function updateBugFlag(id: string, patch: BugFlagPatch) {
  const data = patchSchema.parse(patch);
  const set: Partial<typeof bugFlag.$inferInsert> = {};
  if (data.note !== undefined) set.note = data.note;
  if (data.resolved !== undefined) set.resolvedAt = data.resolved ? new Date() : null;
  if (!Object.keys(set).length)
    return db.query.bugFlag.findFirst({ where: (t, { eq }) => eq(t.id, id) });
  const [updated] = await db.update(bugFlag).set(set).where(eq(bugFlag.id, id)).returning();
  if (data.resolved !== undefined) await bumpVersion(); // open-count badge changed
  return updated;
}

export async function deleteBugFlag(id: string) {
  const [deleted] = await db.delete(bugFlag).where(eq(bugFlag.id, id)).returning();
  await bumpVersion();
  return deleted;
}
