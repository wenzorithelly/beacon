import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/lib/generated/prisma/client";

// Prisma 7 requires a driver adapter at runtime. We use libSQL (SQLite-compatible)
// because better-sqlite3's native addon doesn't load under Bun (oven-sh/bun#4290).
// libSQL takes the same `file:` URL and migrations. Swap to @prisma/adapter-neon
// (or -pg) when deploying to Postgres.
const url = process.env.DATABASE_URL ?? "file:./dev.db";

function createPrismaClient() {
  const adapter = new PrismaLibSql({ url });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
