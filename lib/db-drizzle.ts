import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "@/lib/drizzle/schema";
import * as relations from "@/lib/drizzle/relations";
import { dbUrlFor, getActiveId, getPinnedWorkspaceId } from "@/lib/workspaces";

// Beacon's data client: Drizzle over libSQL. libSQL is the one SQLite driver that loads under BOTH
// runtimes Beacon uses — Node (the Next server) AND Bun (`bun test`, the CLI, the intel watcher) —
// because it's pure JS with no native addon. (Bun's `bun:sqlite` is unavailable inside the Next
// server runtime; better-sqlite3's native addon won't load under Bun. libSQL works in both.)
// Provisioning (schema create + pending migrations + the legacy-timestamp heal) runs in-process via
// the SAME libSQL driver — see lib/drizzle/provision + lib/workspaces.ensureWorkspaceDb.
//
// Per-workspace resolution mirrors the old lib/db.ts: one cached client per workspace db file,
// resolved from the BEACON_REPO env pin → request ALS pin → active workspace → env default.

export { runWithWorkspace } from "@/lib/workspaces";

const fullSchema = { ...schema, ...relations };
export type DB = LibSQLDatabase<typeof fullSchema>;

const DEFAULT_URL = process.env.DATABASE_URL ?? "file:./dev.db";

function createDbClient(dbUrl: string): DB {
  const client = createClient({ url: dbUrl });
  // SQLite enforces FK cascades only when foreign_keys is ON (per connection). libSQL runs requests
  // serially on the connection, so this lands before any app query.
  void client.execute("PRAGMA foreign_keys = ON;");
  return drizzle(client, { schema: fullSchema });
}

const globalForDb = globalThis as unknown as {
  dzByUrl?: Map<string, DB>;
  dzDefault?: DB;
};

// The env-configured client (DATABASE_URL) — used by the CLI, watcher, seeds, tests, and as the
// fallback when no workspace is active.
export const defaultDb = globalForDb.dzDefault ?? createDbClient(DEFAULT_URL);
if (process.env.NODE_ENV !== "production") globalForDb.dzDefault = defaultDb;

const clients = (globalForDb.dzByUrl ??= new Map<string, DB>());

export function getDb(dbUrl: string): DB {
  let c = clients.get(dbUrl);
  if (!c) {
    c = createDbClient(dbUrl);
    clients.set(dbUrl, c);
  }
  return c;
}

export function invalidateDb(dbUrl: string): void {
  clients.delete(dbUrl);
}

// Resolve the workspace this access targets and return its cached client. Provisioning/migration is
// NOT done here: the libSQL migrator is async and this getter is synchronous (it returns a bound
// Drizzle method to call). Callers reach a workspace through an async boundary that has already
// awaited ensureWorkspaceDb — pinned()/the activation routes/MCP startup — so the file + schema are
// ready by the time any query runs. (Provisioning a missing db inside a sync getter used to mean a
// blocking out-of-process `bun` spawn on first access; moving it to the boundary removes that.)
function activeDb(): DB {
  if (process.env.BEACON_REPO) return defaultDb;
  const id = getPinnedWorkspaceId() ?? getActiveId();
  if (!id) return defaultDb;
  return getDb(dbUrlFor(id));
}

// Same ergonomics as before: the whole lib layer imports `db` and the active workspace is resolved
// per access. Drizzle's methods (select/insert/update/delete/query/transaction) are forwarded.
export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    const active = activeDb();
    const value = (active as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(active) : value;
  },
});
