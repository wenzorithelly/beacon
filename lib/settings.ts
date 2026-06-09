import { db, type DB } from "@/lib/db-drizzle";
import { appSetting } from "@/lib/drizzle/schema";

export async function getAppSettings(prisma: DB = db) {
  const [row] = await prisma
    .insert(appSetting)
    .values({ id: "singleton" })
    .onConflictDoUpdate({ target: appSetting.id, set: { id: "singleton" } })
    .returning();
  return row;
}

export async function setAppSettings(
  data: {
    intelModel?: string;
    intelProvider?: string;
    editor?: string;
    currentFeatureId?: string | null;
  },
  prisma: DB = db,
) {
  const [row] = await prisma
    .insert(appSetting)
    .values({ id: "singleton", ...data })
    .onConflictDoUpdate({ target: appSetting.id, set: data })
    .returning();
  return row;
}
