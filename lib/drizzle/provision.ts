import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// In-process provisioning for a workspace's SQLite file, via libSQL — the SAME driver Beacon
// queries with (lib/db-drizzle). libSQL is pure JS, so it loads under BOTH runtimes Beacon uses:
// the Next (Node) server AND Bun (`bun test`, the CLI, the intel watcher). This replaces the old
// out-of-process `bun lib/drizzle/provision.ts` spawn, which needed `bun` on PATH and blocked the
// request thread on a child process. Async because the libSQL migrator is async.

const PKG_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url)))); // lib/drizzle/ → repo root
// `import.meta.url` is correct when running the TS source (dev, `bun test`, the CLI), but it
// points inside `.next`/`dist` once this module is bundled or built. The CLI + the spawned
// production server therefore pass BEACON_MIGRATIONS_DIR (= <install dir>/drizzle) explicitly.
const MIGRATIONS_DIR = process.env.BEACON_MIGRATIONS_DIR || join(PKG_ROOT, "drizzle");

// Datetime columns the old Prisma layer stored as TEXT (ISO-8601). The heal flips them to epoch-ms
// integers (Drizzle's timestamp_ms mode) so reads give real Dates and ORDER BY stays chronological
// (SQLite sorts integers before text, so a mixed column would mis-order).
const DATETIME_COLUMNS: Record<string, string[]> = {
  Node: ["createdAt", "updatedAt"],
  Note: ["createdAt", "updatedAt"],
  DbTable: ["createdAt", "updatedAt"],
  Endpoint: ["createdAt", "updatedAt"],
  DraftTable: ["createdAt"],
  SyncState: ["codeGraphSyncedAt", "updatedAt"],
  AppSetting: ["updatedAt"],
  ProjectMeta: ["updatedAt"],
  CodeFile: ["updatedAt"],
};

async function tableExists(client: Client, name: string): Promise<boolean> {
  const r = await client.execute({
    sql: "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
    args: [name],
  });
  return r.rows.length > 0;
}

async function tableColumns(client: Client, table: string): Promise<Set<string>> {
  const r = await client.execute(`PRAGMA table_info("${table}")`);
  return new Set(r.rows.map((row) => String(row.name)));
}

async function migrationCount(client: Client): Promise<number> {
  if (!(await tableExists(client, "__drizzle_migrations"))) return 0;
  const r = await client.execute('SELECT count(*) AS n FROM "__drizzle_migrations"');
  return Number(r.rows[0]?.n ?? 0);
}

// Idempotent: only rows whose value is still stored as TEXT are converted. julianday() keeps
// millisecond precision (2440587.5 = the Julian day of the Unix epoch; *86400000 = ms/day).
async function migrateDatetimes(client: Client): Promise<void> {
  for (const [table, cols] of Object.entries(DATETIME_COLUMNS)) {
    if (!(await tableExists(client, table))) continue;
    // Guard on the column actually existing: a baselined legacy db (or a future schema that drops a
    // column still listed here) would otherwise throw "no such column" mid-heal.
    const present = await tableColumns(client, table);
    for (const col of cols) {
      if (!present.has(col)) continue;
      await client.execute(
        `UPDATE "${table}" SET "${col}" = CAST((julianday("${col}") - 2440587.5) * 86400000 AS INTEGER) WHERE typeof("${col}") = 'text'`,
      );
    }
  }
}

export interface ProvisionResult {
  /** true when a legacy (pre-Drizzle) db was baselined OR migrate() applied a new migration — i.e. the schema changed. */
  migrated: boolean;
}

/**
 * Make a SQLite file usable by the Drizzle layer, in-process via libSQL. Three idempotent steps:
 *
 *  1. **Baseline a legacy Prisma db.** A pre-Drizzle db has the tables but NO `__drizzle_migrations`
 *     journal. Running the migrator on it would re-run the baseline's `CREATE TABLE`s and clash, so
 *     we mark the baseline migration as already-applied (insert its journal row) first.
 *  2. **Run the Drizzle migrator** (idempotent via its journal): creates the full schema on a fresh
 *     db, or applies ONLY the newer migrations on an existing one. THIS is what makes a schema change
 *     reach every per-workspace db — not just brand-new ones (the bug this replaces only ever ran on
 *     fresh dbs, so a 2nd migration never landed anywhere).
 *  3. **Heal legacy TEXT timestamps** to epoch-ms integers.
 *
 * Throws on a hard failure. `migrationsFolder` is injectable so tests can exercise multi-migration
 * upgrades against a throwaway migrations dir.
 */
export async function provisionDb(
  dbUrl: string,
  migrationsFolder: string = MIGRATIONS_DIR,
): Promise<ProvisionResult> {
  const client = createClient({ url: dbUrl });
  try {
    await client.execute("PRAGMA journal_mode = WAL;");
    await client.execute("PRAGMA foreign_keys = ON;");
    // Provisioning can race the live server/watcher on the same file — wait, don't crash.
    await client.execute("PRAGMA busy_timeout = 5000;");

    const hasJournal = await tableExists(client, "__drizzle_migrations");
    const hasTables = await tableExists(client, "Node");
    let migrated = false;

    // Legacy Prisma db: tables present, no Drizzle journal. Mark the baseline migration applied so
    // migrate() skips its CREATE TABLEs (which would clash) and only applies anything newer.
    if (hasTables && !hasJournal) {
      const base = readMigrationFiles({ migrationsFolder })[0];
      if (base) {
        await client.execute(
          'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
        );
        await client.execute({
          sql: 'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
          args: [base.hash, base.folderMillis],
        });
        migrated = true;
      }
    }

    const before = await migrationCount(client);
    await migrate(drizzle(client), { migrationsFolder });
    if ((await migrationCount(client)) > before) migrated = true;

    await migrateDatetimes(client);
    return { migrated };
  } finally {
    client.close();
  }
}

// CLI entry kept for manual/debug use: `bun lib/drizzle/provision.ts file:./path/db.sqlite`. The
// RUNTIME no longer spawns this — it calls provisionDb() in-process (see lib/workspaces.ensureWorkspaceDb).
if (import.meta.main) {
  const url = process.argv[2];
  if (!url) {
    console.error("usage: bun lib/drizzle/provision.ts <db-file-url>");
    process.exit(1);
  }
  await provisionDb(url);
}
