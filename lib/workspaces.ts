import { AsyncLocalStorage } from "node:async_hooks";
import { spawnSync } from "node:child_process";
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

/**
 * The git toplevel for `cwd` (so a subdirectory of a repo still maps to the repo's workspace),
 * falling back to `cwd` itself when it isn't a git repo. Shared by `beacon mcp` and the
 * PostToolUse hook so both derive the SAME workspace id from a session's working directory —
 * which is what keeps an agent's edits attached to its own repo instead of the global active.
 */
export function repoRootFrom(cwd: string = process.cwd()): string {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (r.status === 0) {
    const top = r.stdout?.toString().trim();
    if (top) return top;
  }
  return cwd;
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
  if (getActiveId() === id) setActiveId(listWorkspaces()[0]?.id ?? null);
}

// The single active workspace (the user picked "one at a time") persisted to disk.
// We deliberately re-read on every call: Next.js dev runs API routes and RSC page
// renders in separate worker processes, so an in-memory cache in one worker would
// hide POSTs handled by another and make /map and /db render the previous workspace.
// The file is tiny and OS-cached; the syscall cost is negligible per query.
function activePath(): string {
  return join(beaconHome(), "active");
}

export function getActiveId(): string | null {
  try {
    return readFileSync(activePath(), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function setActiveId(id: string | null): void {
  mkdirSync(beaconHome(), { recursive: true });
  writeFileSync(activePath(), id ?? "");
}

/** The active workspace record (validated against the registry), or null. */
export function activeWorkspace(): Workspace | null {
  const id = getActiveId();
  return id ? getWorkspace(id) : null;
}

/**
 * The workspace the CURRENT request/render operates on: the per-request pin (set by
 * runWithWorkspace from the header or browser cookie) when present, else the global active.
 * Use this — not activeWorkspace() — anywhere the result is handed to the client (e.g. the
 * page's workspaceId), so it tracks the cookie pin instead of the agent-mutable active file.
 */
export function currentWorkspace(): Workspace | null {
  const id = getPinnedWorkspaceId() ?? getActiveId();
  return id ? getWorkspace(id) : null;
}

/** Path stored on disk for a workspace, or null. Lets the data dir resolve a repo. */
export function pathForWorkspace(id: string): string | null {
  return getWorkspace(id)?.path ?? null;
}

export function registryExists(): boolean {
  return existsSync(registryPath());
}

// The browser stores its explicitly-selected workspace here so it survives background
// agent activity. It's distinct from the global `active` file (which any agent push or CLI
// open mutates) precisely so the dropdown selection is durable per-browser.
export const BEACON_WS_COOKIE = "beacon_ws";

/** Parse one cookie value out of a Cookie header (no deps). */
function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * The workspace a request wants to be pinned to, resolved in priority order:
 *   1. the `x-beacon-workspace` HEADER — the MCP server sets this to the repo its Claude
 *      Code session runs in; it must win so an agent's writes land in its own repo.
 *   2. the `beacon_ws` COOKIE — the browser's explicit dropdown selection, so background
 *      agent activations (which flip the global `active`) can't yank the user's view.
 * Each is validated against the registry; an unknown/stale id is ignored. Returns null when
 * neither is present/valid, so the caller falls back to the global active workspace.
 */
export function workspaceIdFromRequest(req: Request): string | null {
  const header = req.headers.get("x-beacon-workspace");
  if (header && getWorkspace(header)) return header;
  const cookie = cookieValue(req, BEACON_WS_COOKIE);
  if (cookie && getWorkspace(cookie)) return cookie;
  return null;
}

// The MCP server / intel watcher also send the repo's PATH on this header. It lets the server
// self-register an agent's workspace the FIRST time it's seen — so an agent whose repo was never
// opened with `beacon` still pins to its OWN db instead of silently writing to the browser's active
// repo. Browsers never send it (they only have an id), so it can't move a browser's view.
export const BEACON_WS_PATH_HEADER = "x-beacon-workspace-path";

/**
 * Async superset of {@link workspaceIdFromRequest} for WRITE boundaries (pinned routes + the intel
 * watcher's ingest routes). Resolves the workspace to pin to, and SELF-HEALS an agent's workspace so
 * its writes never fall back to the browser's active repo:
 *   1. `x-beacon-workspace` header, if it names a registered workspace.
 *   2. else `x-beacon-workspace-path` (agent/watcher only): register that repo + provision its db on
 *      demand, then pin to it. The path must hash to the sent id (when one was sent), so a stale or
 *      foreign id can't register a mismatched path.
 *   3. else the `beacon_ws` cookie (browser selection).
 *   4. else null → caller falls back to the global active workspace.
 */
export async function resolveRequestWorkspaceId(req: Request): Promise<string | null> {
  const headerId = req.headers.get("x-beacon-workspace");
  if (headerId && getWorkspace(headerId)) return headerId;
  const headerPath = req.headers.get(BEACON_WS_PATH_HEADER);
  if (headerPath && (!headerId || idForPath(headerPath) === headerId)) {
    const ws = addWorkspace(headerPath);
    await ensureWorkspaceDb(ws.id);
    return ws.id;
  }
  const cookie = cookieValue(req, BEACON_WS_COOKIE);
  if (cookie && getWorkspace(cookie)) return cookie;
  return null;
}

// ── Per-request workspace pin (AsyncLocalStorage) ───────────────────────────
//
// An API route wraps its handler in `runWithWorkspace(id, fn)` to force everything
// inside — both `db` access (lib/db.ts) AND the repo filesystem path (lib/project.ts
// repoRoot, which drives AGENTS.md writes) — to target ONE workspace instead of the
// server's global active one. This keeps an MCP request pinned to the repo the agent's
// Claude Code session runs in, even when the human has a different project selected in
// the browser dropdown. Without it, a `/beacon-init` from one repo lands in whatever
// workspace happened to be active — the cross-workspace corruption this guards against.
const workspacePinALS = new AsyncLocalStorage<string>();

/** Run `fn` with db + repoRoot pinned to workspace `id`. No-op when id is null. */
export function runWithWorkspace<T>(id: string | null | undefined, fn: () => T): T {
  return id ? workspacePinALS.run(id, fn) : fn();
}

/** The workspace id pinned for the current async context, or null. */
export function getPinnedWorkspaceId(): string | null {
  return workspacePinALS.getStore() ?? null;
}

// ── Schema provisioning + migrations (self-heal) ────────────────────────────
//
// A workspace can be in the registry without its db.sqlite existing on disk (the user wiped the
// data, then `/beacon-init` re-registered the repo before `beacon` ran inside it), and an EXISTING
// db can be a migration behind after a Beacon upgrade. ensureWorkspaceDb is the self-heal for both:
// it provisions a missing schema AND applies any pending migrations, in-process via libSQL (see
// lib/drizzle/provision). Async because the libSQL migrator is async — callers MUST await it at a
// request boundary (pinned()/the activation routes/MCP startup) BEFORE the first query, since the
// synchronous `db` Proxy getter can no longer block on provisioning. Never throws — returns ok=false
// with the error so the caller can surface it cleanly.

export interface EnsureWorkspaceDbResult {
  ok: boolean;
  /** true when this call created the db file (it was missing). */
  created: boolean;
  /** true when an existing db's schema changed this call (a pending migration applied, or a legacy db was baselined). */
  migrated: boolean;
  /** populated when ok=false; a description of the failure. */
  error?: string;
}

// Provision + migrate at most once per process per db file. migrate() is idempotent, but skipping the
// repeat keeps pinned() cheap to call on every request (it short-circuits once the file is known-current).
const provisionedThisProcess = new Set<string>();

// Make a workspace's db usable: provision the schema when missing, apply pending migrations, and
// convert any legacy Prisma TEXT timestamps to epoch-ms integers (all idempotent). Runs in-process
// via libSQL — no `bun`-on-PATH dependency, no out-of-process spawn. Never throws.
export async function ensureWorkspaceDb(id: string): Promise<EnsureWorkspaceDbResult> {
  const dir = dataDirFor(id);
  const file = join(dir, "db.sqlite");
  const existed = existsSync(file);
  if (existed && provisionedThisProcess.has(file)) {
    return { ok: true, created: false, migrated: false };
  }
  try {
    mkdirSync(dir, { recursive: true });
    const { provisionDb } = await import("@/lib/drizzle/provision");
    const res = await provisionDb(dbUrlFor(id));
    provisionedThisProcess.add(file);
    // `migrated` only describes schema drift on an ALREADY-existing db; a brand-new file is `created`.
    return { ok: true, created: !existed, migrated: existed && res.migrated };
  } catch (e) {
    return {
      ok: false,
      created: false,
      migrated: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
