import { db } from "@/lib/db";

type Prisma = typeof db;

export async function getAppSettings(prisma: Prisma = db) {
  return prisma.appSetting.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
  });
}

export async function setAppSettings(
  data: {
    intelModel?: string;
    intelProvider?: string;
    editor?: string;
    currentFeatureId?: string | null;
  },
  prisma: Prisma = db,
) {
  return prisma.appSetting.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...data },
    update: data,
  });
}
