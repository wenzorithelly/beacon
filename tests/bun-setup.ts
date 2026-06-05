import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Preload (runs once): point at a throwaway test DB and push the current schema.
// `bun test` runs all files in one process, so a single fresh DB is correct, and
// Bun loads the generated Prisma client directly (no transform cache to go stale).
process.env.DATABASE_URL = "file:./test.db";
// Isolate the workspace registry + active-workspace pointer from the real ~/.beacon,
// so an activated workspace can never redirect `db` away from test.db.
process.env.BEACON_HOME = mkdtempSync(join(tmpdir(), "beacon-test-home-"));
rmSync("test.db", { force: true });
rmSync("test.db-journal", { force: true });
execSync('bunx prisma db push --url "file:./test.db"', { stdio: "inherit" });
