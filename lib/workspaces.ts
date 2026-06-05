import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// Registry of the repos Beacon knows about. One Beacon server serves them all
// (multi-workspace): each repo keeps its own per-id data dir + sqlite, and the
// server resolves which workspace a request is for. The registry is a small JSON
// file so the CLI and the server share the same source of truth.
//
// BEACON_HOME overrides the root (tests point it at a temp dir).

export interface Workspace {
  id: string;
  path: string;
  name: string;
  lastOpenedAt: string;
}

export function beaconHome(): string {
  return process.env.BEACON_HOME || join(homedir(), ".beacon");
}

function registryPath(): string {
  return join(beaconHome(), "workspaces.json");
}

/** Stable per-repo id — same hashing the CLI/project use, so data dirs line up. */
export function idForPath(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 12);
}

export function dataDirFor(id: string): string {
  return join(beaconHome(), id);
}

export function dbUrlFor(id: string): string {
  return `file:${join(dataDirFor(id), "db.sqlite")}`;
}

function readRegistry(): Workspace[] {
  try {
    const raw = JSON.parse(readFileSync(registryPath(), "utf8"));
    return Array.isArray(raw) ? (raw as Workspace[]) : [];
  } catch {
    return [];
  }
}

function writeRegistry(list: Workspace[]): void {
  mkdirSync(beaconHome(), { recursive: true });
  writeFileSync(registryPath(), JSON.stringify(list, null, 2));
}

export function listWorkspaces(): Workspace[] {
  return readRegistry().sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
}

export function getWorkspace(id: string): Workspace | null {
  return readRegistry().find((w) => w.id === id) ?? null;
}

/** Add a repo (or refresh its name) and mark it most-recently-opened. Idempotent. */
export function addWorkspace(path: string, name?: string, now = new Date().toISOString()): Workspace {
  const id = idForPath(path);
  const list = readRegistry();
  const existing = list.find((w) => w.id === id);
  const ws: Workspace = {
    id,
    path,
    name: name || existing?.name || basename(path),
    lastOpenedAt: now,
  };
  const next = [ws, ...list.filter((w) => w.id !== id)];
  mkdirSync(dataDirFor(id), { recursive: true });
  writeRegistry(next);
  return ws;
}

export function touchWorkspace(id: string, now = new Date().toISOString()): void {
  const list = readRegistry();
  const w = list.find((x) => x.id === id);
  if (!w) return;
  w.lastOpenedAt = now;
  writeRegistry(list);
}

export function removeWorkspace(id: string): void {
  writeRegistry(readRegistry().filter((w) => w.id !== id));
}

/** Path stored on disk for a workspace, or null. Lets the data dir resolve a repo. */
export function pathForWorkspace(id: string): string | null {
  return getWorkspace(id)?.path ?? null;
}

export function registryExists(): boolean {
  return existsSync(registryPath());
}
