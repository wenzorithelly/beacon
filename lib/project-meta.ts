import { db } from "@/lib/db";

type Prisma = typeof db;

export async function getProjectMeta(prisma: Prisma = db) {
  return prisma.projectMeta.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
  });
}

export async function setProjectMeta(
  data: { overview?: string | null; conventions?: string[] },
  prisma: Prisma = db,
) {
  return prisma.projectMeta.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      overview: data.overview ?? null,
      conventions: JSON.stringify(data.conventions ?? []),
    },
    update: {
      overview: data.overview ?? undefined,
      conventions: data.conventions ? JSON.stringify(data.conventions) : undefined,
    },
  });
}
