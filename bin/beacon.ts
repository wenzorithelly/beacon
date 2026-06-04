#!/usr/bin/env bun
/**
 * Beacon CLI — run `beacon` in any repo to launch a local control panel for it.
 * Resolves the repo, keeps per-repo data in ~/.beacon/<id>/, ensures the schema,
 * then boots the Next app + the code-intelligence watcher against that repo.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const cwd = process.cwd();

function gitToplevel(): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const repo = gitToplevel() || cwd;
const id = createHash("sha256").update(repo).digest("hex").slice(0, 12);
const data = join(homedir(), ".beacon", id);
mkdirSync(data, { recursive: true });

const dbFile = join(data, "db.sqlite");
const dbUrl = `file:${dbFile}`;
const port = process.env.PORT || "4319";
const url = `http://localhost:${port}`;

const env = {
  ...process.env,
  BEACON_REPO: repo,
  BEACON_DATA_DIR: data,
  DATABASE_URL: dbUrl,
  PORT: port,
};

if (!existsSync(dbFile)) {
  console.log(`[beacon] first run for ${repo} — creating database…`);
  execSync(
    `bunx prisma db push --url "${dbUrl}" --schema "${join(pkgDir, "prisma/schema.prisma")}"`,
    { cwd: pkgDir, env, stdio: "inherit" },
  );
}

console.log(`\n  ◉ Beacon\n  repo:  ${repo}\n  data:  ${data}\n  url:   ${url}\n`);

const app = spawn("bun", ["run", "dev"], { cwd: pkgDir, env, stdio: "inherit" });

// Give the app a moment to come up, then start the watcher + open the browser.
const watchTimer = setTimeout(() => {
  spawn("bun", ["run", "intel/watch.ts"], { cwd: pkgDir, env, stdio: "inherit" });
  if (!process.env.BEACON_NO_OPEN) {
    const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
    try {
      execSync(`${opener} ${url}`, { stdio: "ignore" });
    } catch {
      /* no browser opener available */
    }
  }
}, 3500);

function shutdown() {
  clearTimeout(watchTimer);
  try {
    app.kill();
  } catch {
    /* already gone */
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
