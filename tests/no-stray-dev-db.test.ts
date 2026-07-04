import { test, expect } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

// Regression: `beacon mcp` is spawned per-repo with cwd = the repo. Importing the db layer must NOT
// create file:./dev.db in cwd — the eager module-level client used to drop a stray dev.db in every
// repo even though the MCP server always pins a real workspace db. Import is now side-effect-free;
// the fallback client is created lazily only when something actually resolves to it.
test("importing the db module does not create dev.db in cwd", () => {
  const dir = mkdtempSync(join(tmpdir(), "beacon-devdb-"));
  const mod = resolve(import.meta.dir, "../lib/db-drizzle.ts");
  try {
    // Fresh process, cwd = the temp dir, isolated BEACON_HOME, no workspace registered.
    const r = spawnSync("bun", ["-e", `await import(${JSON.stringify(mod)})`], {
      cwd: dir,
      env: { ...process.env, BEACON_HOME: join(dir, ".beacon") },
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(existsSync(join(dir, "dev.db"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
