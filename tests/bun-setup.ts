import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provisionDb } from "@/lib/drizzle/provision";

// Preload (runs once): point at a throwaway test DB and provision the current schema in-process via
// libSQL (no spawn — the same driver the app queries with). `bun test` runs all files in one
// process, so a single fresh DB is correct. Bun preloads support top-level await.
process.env.DATABASE_URL = "file:./test.db";
// Isolate the workspace registry + active-workspace pointer from the real ~/.beacon,
// so an activated workspace can never redirect `db` away from test.db.
process.env.BEACON_HOME = mkdtempSync(join(tmpdir(), "beacon-test-home-"));
for (const f of ["test.db", "test.db-journal", "test.db-wal", "test.db-shm"]) {
  rmSync(f, { force: true });
}
await provisionDb("file:./test.db");
