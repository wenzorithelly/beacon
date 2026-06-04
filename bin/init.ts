#!/usr/bin/env bun
/**
 * `beacon init` — read an existing repo, understand it, and map its architecture +
 * database into the per-repo store. Run once on a repo you already have work in.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const cwd = process.cwd();

function gitToplevel(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd, stdio: ["ignore", "pipe", "ignore"] })
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

process.env.BEACON_REPO = repo;
process.env.BEACON_DATA_DIR = data;
process.env.DATABASE_URL = `file:${dbFile}`;

if (!existsSync(dbFile)) {
  execSync(
    `bunx prisma db push --url "file:${dbFile}" --schema "${join(pkgDir, "prisma/schema.prisma")}"`,
    { cwd: pkgDir, env: process.env, stdio: "inherit" },
  );
}

console.log(`\n  ◉ Beacon init\n  repo: ${repo}\n  reading + mapping (this uses the AI; may take a minute)…\n`);

// Import after env is set so the Prisma client points at the per-repo DB.
const { runInit } = await import(join(pkgDir, "lib/init.ts"));
const r = await runInit();

console.log(
  `\n  ✓ mapped ${r.components} components · ${r.tables} tables · ${r.endpoints} endpoints` +
    ` · ${r.roadmap} roadmap suggestions (from ${r.files} files)\n` +
    `  → run \`beacon\` to open the map.\n`,
);
process.exit(0);
