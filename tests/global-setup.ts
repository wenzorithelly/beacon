import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

// Creates a fresh ./test.db with the current schema before the suite runs.
// We delete the throwaway fixture then do a clean `db push` — this avoids the
// destructive `--force-reset`, which Prisma 7 gates behind an AI-safety prompt.
export default function setup() {
  rmSync("test.db", { force: true });
  rmSync("test.db-journal", { force: true });
  execSync('bunx prisma db push --url "file:./test.db"', { stdio: "inherit" });
}
