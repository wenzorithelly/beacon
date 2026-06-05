#!/usr/bin/env bun
/**
 * Beacon CLI — run `beacon` in any repo to open it in the local control panel.
 * One shared Beacon server (daemon) serves every repo you've opened; each repo keeps
 * its own data in ~/.beacon/<id>/. `beacon` registers the current repo, makes sure the
 * daemon + a per-repo watcher are running, then opens the browser on that repo.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const cwd = process.cwd();
const BEACON_HOME = process.env.BEACON_HOME || join(homedir(), ".beacon");
const SERVER_FILE = join(BEACON_HOME, "server.json");
const PORT = process.env.PORT || "4319";

// Subcommands: `beacon init` (map an existing repo) / `beacon mcp` (MCP server) /
// `beacon hook` (PostToolUse reporter) / `beacon stop` (stop the daemon).
const sub = process.argv[2];
if (sub === "init") {
  await import(join(pkgDir, "bin/init.ts"));
} else if (sub === "mcp") {
  await import(join(pkgDir, "bin/mcp.ts"));
} else if (sub === "hook") {
  await import(join(pkgDir, "bin/hook.ts"));
} else if (sub === "stop") {
  stopDaemon();
} else {
  await launchPanel();
}

function gitToplevel(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function urlOk(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url: string, tries = 60): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await urlOk(url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// Start the shared server detached (survives this CLI exiting) and record its pid+port.
function startDaemon(): { pid: number; port: string } {
  mkdirSync(BEACON_HOME, { recursive: true });
  const log = openSync(join(BEACON_HOME, "server.log"), "a");
  // No BEACON_REPO → the server follows the active workspace (multi-workspace mode).
  const env = { ...process.env, PORT, BEACON_NO_OPEN: "1" };
  delete env.BEACON_REPO;
  delete env.BEACON_DATA_DIR;
  delete env.DATABASE_URL;
  const child = spawn("bun", ["run", "dev"], {
    cwd: pkgDir,
    env,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  const info = { pid: child.pid ?? 0, port: PORT };
  writeFileSync(SERVER_FILE, JSON.stringify(info));
  return info;
}

async function ensureDaemon(): Promise<string> {
  const existing = readJson<{ pid: number; port: string }>(SERVER_FILE);
  if (existing && isAlive(existing.pid) && (await urlOk(`http://localhost:${existing.port}/api/workspace`))) {
    return existing.port;
  }
  console.log("[beacon] starting the Beacon server…");
  const { port } = startDaemon();
  const ready = await waitForUrl(`http://localhost:${port}/api/workspace`);
  if (!ready) console.log("[beacon] (server is taking a while — it may still be compiling)");
  return port;
}

// One watcher per repo, tracked by a pidfile in the repo's data dir.
function ensureWatcher(repo: string, data: string, dbUrl: string, port: string) {
  const pidFile = join(data, "watcher.pid");
  const prev = readJson<{ pid: number }>(pidFile);
  if (prev && isAlive(prev.pid)) return;
  const log = openSync(join(data, "watcher.log"), "a");
  const env = {
    ...process.env,
    BEACON_REPO: repo,
    BEACON_DATA_DIR: data,
    DATABASE_URL: dbUrl,
    PORT: port,
  };
  const child = spawn("bun", ["run", "intel/watch.ts"], {
    cwd: pkgDir,
    env,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  writeFileSync(pidFile, JSON.stringify({ pid: child.pid ?? 0 }));
}

function openBrowser(url: string) {
  if (process.env.BEACON_NO_OPEN) return;
  const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  try {
    execSync(`${opener} "${url}"`, { stdio: "ignore" });
  } catch {
    /* no browser opener available */
  }
}

async function launchPanel() {
  const repo = gitToplevel() || cwd;
  const { addWorkspace, idForPath, dataDirFor, dbUrlFor } = await import(
    join(pkgDir, "lib/workspaces.ts")
  );
  const id = idForPath(repo);
  const data = dataDirFor(id);
  const dbUrl = dbUrlFor(id);
  mkdirSync(data, { recursive: true });

  // First run for this repo: create its database.
  if (!existsSync(join(data, "db.sqlite"))) {
    console.log(`[beacon] first run for ${repo} — creating database…`);
    execSync(
      `bunx prisma db push --url "${dbUrl}" --schema "${join(pkgDir, "prisma/schema.prisma")}"`,
      { cwd: pkgDir, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "inherit" },
    );
    console.log("[beacon] tip: already have code here? run `beacon init` to map the project.");
  }

  // Register the repo, ensure the shared server + a per-repo watcher, then open the
  // browser straight onto this repo (activate makes it the server's active workspace).
  addWorkspace(repo);
  const port = await ensureDaemon();
  ensureWatcher(repo, data, dbUrl, port);
  const activate = `http://localhost:${port}/api/workspace/activate?id=${id}&redirect=/map`;

  console.log(
    `\n  ◉ Beacon\n  repo:  ${repo}\n  data:  ${data}\n  url:   http://localhost:${port}\n`,
  );
  console.log("  (the server keeps running in the background — `beacon stop` to stop it)\n");
  openBrowser(activate);
}

function stopDaemon() {
  const info = readJson<{ pid: number }>(SERVER_FILE);
  if (info && isAlive(info.pid)) {
    try {
      process.kill(info.pid);
      console.log(`[beacon] stopped the server (pid ${info.pid}).`);
    } catch {
      console.log("[beacon] could not stop the server.");
    }
  } else {
    console.log("[beacon] no server running.");
  }
}
