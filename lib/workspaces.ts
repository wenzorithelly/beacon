import { AsyncLocalStorage } from "node:async_hooks";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, parse, resolve } from "node:path";

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

/**
 * Paths that must NEVER become a workspace. repoRootFrom() falls back to `cwd` when a session
 * runs OUTSIDE any git repo, so an agent started in the home directory (e.g. `claude` in ~)
 * would otherwise re-register the home dir on every session — even after the user deletes it.
 * The home directory and a filesystem root are never repos.
 */
export function isRegistrableWorkspacePath(path: string): boolean {
  const r = resolve(path);
  return r !== resolve(homedir()) && r !== parse(r).root;
}

// ── Deletion tombstones ─────────────────────────────────────────────────────
//
// Deleting a workspace must STICK: implicit self-heal (the MCP server's startup register and the
// header self-register below) would otherwise re-add it the next time an agent session runs in
// that repo. We record deleted ids in a small ~/.beacon/deleted.json denylist; implicit
// registration refuses a tombstoned id, and ONLY an explicit `beacon` / `/beacon-init`
// (registerWorkspaceExplicit) clears it. Same JSON-file shape as the registry.

function deletedPath(): string {
  return join(beaconHome(), "deleted.json");
}

function readDeleted(): string[] {
  try {
    const raw = JSON.parse(readFileSync(deletedPath(), "utf8"));
    return Array.isArray(raw) ? (raw as string[]) : [];
  } catch {
    return [];
  }
}

function writeDeleted(ids: string[]): void {
  mkdirSync(beaconHome(), { recursive: true });
  writeFileSync(deletedPath(), JSON.stringify(ids, null, 2));
}

/** True when this workspace id was deleted and not yet explicitly re-added. */
export function isWorkspaceDeleted(id: string): boolean {
  return readDeleted().includes(id);
}

/** Record a deletion so implicit self-heal can't resurrect it. */
export function tombstoneWorkspace(id: string): void {
  const ids = readDeleted();
  if (!ids.includes(id)) writeDeleted([...ids, id]);
}

/** Clear a deletion tombstone — the user opted back in via `beacon` / `/beacon-init`. */
export function clearWorkspaceTombstone(id: string): void {
  const ids = readDeleted();
  if (ids.includes(id)) writeDeleted(ids.filter((x) => x !== id));
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

/**
 * Add a repo (or refresh its name) and mark it most-recently-opened. Idempotent.
 *
 * Refuses two classes of path so the registry never fills with junk: the home dir / filesystem
 * root (never a repo — see isRegistrableWorkspacePath) and a DELETED workspace (a tombstone the
 * user hasn't explicitly cleared). Implicit callers (MCP startup, the header self-register) wrap
 * this in a try/catch or pre-check; explicit re-adds go through registerWorkspaceExplicit, which
 * clears the tombstone first.
 */
export function addWorkspace(path: string, name?: string, now = new Date().toISOString()): Workspace {
  if (!isRegistrableWorkspacePath(path)) {
    throw new Error(`beacon: refusing to register a non-repo path as a workspace: ${path}`);
  }
  const id = idForPath(path);
  if (isWorkspaceDeleted(id)) {
    throw new Error(
      `beacon: workspace ${id} (${path}) was deleted — run \`beacon\` or /beacon-init to re-add it`,
    );
  }
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

/**
 * Explicit, user-initiated registration: clears any deletion tombstone, then registers. The ONLY
 * way a deleted workspace comes back — used by `beacon` (launchPanel) and /beacon-init. Implicit
 * self-heal never calls this, so a workspace deleted in Settings stays gone until the user opts in.
 */
export function registerWorkspaceExplicit(path: string, name?: string): Workspace {
  clearWorkspaceTombstone(idForPath(path));
  return addWorkspace(path, name);
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
  return loneWorkspaceId();
}

// When neither the header nor the cookie (nor, for the async resolver, the path) names a
// registered workspace, a registry with EXACTLY ONE workspace is unambiguous — pin to it. This
// makes the common single-project case work even when the MCP client (e.g. Cursor in a
// multi-folder workspace) launches the server with a cwd that isn't the registered repo, so the
// agent no longer has to name the project. With several workspaces it stays null (genuinely
// ambiguous): the caller degrades to the global active one and the MCP logs a hint.
function loneWorkspaceId(): string | null {
  const all = listWorkspaces();
  return all.length === 1 ? all[0].id : null;
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
  if (
    headerPath &&
    isRegistrableWorkspacePath(headerPath) &&
    !isWorkspaceDeleted(idForPath(headerPath)) &&
    (!headerId || idForPath(headerPath) === headerId)
  ) {
    // Implicit self-heal — only for a never-deleted, real repo. A tombstoned or home path falls
    // through to the cookie/active fallback instead of silently resurrecting a deleted workspace.
    const ws = addWorkspace(headerPath);
    await ensureWorkspaceDb(ws.id);
    return ws.id;
  }
  const cookie = cookieValue(req, BEACON_WS_COOKIE);
  if (cookie && getWorkspace(cookie)) return cookie;
  // NB: NO lone-workspace fallback here — this is the WRITE/watcher boundary (the intel ingest),
  // which must FAIL CLOSED on an unresolvable workspace rather than guess. The lone-workspace
  // convenience lives in workspaceIdFromRequest, used by the MCP agent-tool routes.
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

/** Forget the per-process provision cache for a workspace's db file. Needed when the file is
 *  deleted (workspace deletion): otherwise a re-added workspace short-circuits ensureWorkspaceDb
 *  on the stale cache entry and its first query hits SQLITE_CANTOPEN. */
export function forgetWorkspaceDb(id: string): void {
  provisionedThisProcess.delete(join(dataDirFor(id), "db.sqlite"));
}

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
