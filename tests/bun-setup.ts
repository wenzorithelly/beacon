import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

// Preload (runs once): point at a throwaway test DB and push the current schema.
// `bun test` runs all files in one process, so a single fresh DB is correct, and
// Bun loads the generated Prisma client directly (no transform cache to go stale).
process.env.DATABASE_URL = "file:./test.db";
rmSync("test.db", { force: true });
rmSync("test.db-journal", { force: true });
execSync('bunx prisma db push --url "file:./test.db"', { stdio: "inherit" });
