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

export type Db = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma?: Db;
  prismaByUrl?: Map<string, Db>;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

// Multi-workspace: one server serves many repos, each with its own sqlite. Resolve
// (and cache) a Prisma client per database URL so a request can talk to whichever
// workspace it targets. Cached on globalThis so dev hot-reload doesn't leak clients.
const clients = (globalForPrisma.prismaByUrl ??= new Map<string, Db>());

export function getDb(dbUrl: string): Db {
  let c = clients.get(dbUrl);
  if (!c) {
    c = new PrismaClient({ adapter: new PrismaLibSql({ url: dbUrl }) });
    clients.set(dbUrl, c);
  }
  return c;
}
