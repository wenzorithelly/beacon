import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { dbUrlFor, getActiveId } from "@/lib/workspaces";

// Prisma 7 requires a driver adapter at runtime. We use libSQL (SQLite-compatible)
// because better-sqlite3's native addon doesn't load under Bun (oven-sh/bun#4290).
// libSQL takes the same `file:` URL and migrations. Swap to @prisma/adapter-neon
// (or -pg) when deploying to Postgres.
const url = process.env.DATABASE_URL ?? "file:./dev.db";

function createPrismaClient(dbUrl = url) {
  return new PrismaClient({ adapter: new PrismaLibSql({ url: dbUrl }) });
}

export type Db = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma?: Db;
  prismaByUrl?: Map<string, Db>;
};

// The env-configured client (DATABASE_URL). Used outside the server (CLI, watcher,
// seeds, tests) and as the fallback when no workspace is active.
export const defaultDb = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = defaultDb;

// Resolve (and cache) a Prisma client per database URL — one per workspace.
const clients = (globalForPrisma.prismaByUrl ??= new Map<string, Db>());

export function getDb(dbUrl: string): Db {
  let c = clients.get(dbUrl);
  if (!c) {
    c = createPrismaClient(dbUrl);
    clients.set(dbUrl, c);
  }
  return c;
}

// One Beacon server serves many repos with a single active workspace at a time. `db`
// resolves to the active workspace's client (or the env default when none is active),
// so the whole lib layer keeps using `db` unchanged — no per-call threading.
// A process pinned to one repo via BEACON_REPO (CLI / watcher / init) always uses its
// own env DB, so per-repo watchers never write into whatever the server has active.
function activeDb(): Db {
  if (process.env.BEACON_REPO) return defaultDb;
  const id = getActiveId();
  return id ? getDb(dbUrlFor(id)) : defaultDb;
}

export const db: Db = new Proxy({} as Db, {
  get(_t, prop) {
    const active = activeDb();
    const value = (active as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(active) : value;
  },
});
