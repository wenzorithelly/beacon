import { existsSync } from "node:fs";
import { getWorkspace, listWorkspaces } from "@/lib/workspaces";
import { startWatcherForWorkspace } from "@/intel/watch-inline";

// Manages one code-graph watcher per ACTIVE workspace. The Beacon daemon serves every
// registered repo, but watching all of them would be N chokidar instances + N scans for
// repos you aren't using. So we watch the recently-opened subset (top-N by lastOpenedAt)
// and lazily warm a watcher for any repo the moment it's queried (ensureWatcher). The
// active-watcher set doubles as the staleness signal's "is this repo being watched?".

export interface WatchableWorkspace {
  id: string;
  path: string;
  name: string;
}

export interface WatcherHandle {
  stop: () => Promise<void>;
}

export interface WatcherManagerDeps {
  list: () => WatchableWorkspace[]; // registry, most-recently-opened first
  get: (id: string) => WatchableWorkspace | null;
  exists: (path: string) => boolean;
  start: (ws: WatchableWorkspace) => WatcherHandle;
  /** How many top workspaces get an auto-started watcher on boot/reconcile. */
  limit?: number;
  /** Absolute cap on concurrent watchers (auto + lazy) before LRU eviction kicks in. */
  hardCap?: number;
}

export function createWatcherManager(deps: WatcherManagerDeps) {
  const limit = deps.limit ?? 6;
  const hardCap = deps.hardCap ?? 12;
  const active = new Map<string, { handle: WatcherHandle; seq: number }>();
  let seq = 0;
  let topIds = new Set<string>();

  function touch(id: string): void {
    const e = active.get(id);
    if (e) e.seq = ++seq;
  }

  function startFor(ws: WatchableWorkspace): void {
    if (active.has(ws.id)) return touch(ws.id);
    if (!deps.exists(ws.path)) return;
    active.set(ws.id, { handle: deps.start(ws), seq: ++seq });
  }

  /** Stop the oldest watcher that isn't in the current top-N (protected) set. */
  function evictLruNonTop(): void {
    let victim: string | null = null;
    let min = Infinity;
    for (const [id, e] of active) {
      if (topIds.has(id)) continue;
      if (e.seq < min) {
        min = e.seq;
        victim = id;
      }
    }
    if (victim) {
      void active.get(victim)!.handle.stop();
      active.delete(victim);
    }
  }

  /** Start watchers for the top-N existing workspaces; stop any whose repo vanished. */
  function reconcile(): void {
    const top = deps.list().filter((w) => deps.exists(w.path)).slice(0, limit);
    topIds = new Set(top.map((w) => w.id));
    for (const ws of top) startFor(ws);
    for (const [id, e] of [...active]) {
      const ws = deps.get(id);
      if (!ws || !deps.exists(ws.path)) {
        void e.handle.stop();
        active.delete(id);
      }
    }
  }

  /** Lazily warm a watcher for a repo being queried (no-op if already watching). */
  function ensureWatcher(id: string): void {
    if (active.has(id)) return touch(id);
    const ws = deps.get(id);
    if (!ws || !deps.exists(ws.path)) return;
    if (active.size >= hardCap) evictLruNonTop();
    if (active.size >= hardCap) return; // every watcher is top-N protected — refuse
    active.set(id, { handle: deps.start(ws), seq: ++seq });
  }

  function isWatching(id: string): boolean {
    return active.has(id);
  }

  function activeIds(): string[] {
    return [...active.keys()];
  }

  async function stopAll(): Promise<void> {
    await Promise.all([...active.values()].map((e) => e.handle.stop()));
    active.clear();
  }

  return { reconcile, ensureWatcher, isWatching, activeIds, stopAll };
}

// ── Process-wide singleton, wired to the real registry + watcher factory ──────────

const manager = createWatcherManager({
  list: listWorkspaces,
  get: getWorkspace,
  exists: existsSync,
  start: (ws) => startWatcherForWorkspace(ws),
});

let timer: ReturnType<typeof setInterval> | null = null;

// The inline watcher's warm-up scans the repo, but the extract is now time-sliced
// (intel/extractors/code-graph.ts yields the event loop every ~5ms), so a cold scan no
// longer blocks the daemon — the lazy-warm paths (workspace activate, the freshness check)
// are safe to run in prod. Only the explicit escape hatch disables it now; instrumentation.ts
// separately keeps BOOT-TIME warming off in prod (lazy-only), so warming happens on demand.
function inlineWatchDisabled(): boolean {
  return process.env.BEACON_NO_INLINE_WATCH === "1";
}

/** Boot watchers for the active workspaces and keep reconciling as the registry changes. */
export function startWorkspaceWatchers(): void {
  if (inlineWatchDisabled()) return;
  manager.reconcile();
  if (!timer) {
    timer = setInterval(() => manager.reconcile(), 30_000);
    timer.unref?.();
  }
}

/** Lazily ensure a queried repo has a live watcher (called by the context/blast-radius routes). */
export function ensureWatcher(id: string): void {
  if (inlineWatchDisabled()) return;
  manager.ensureWatcher(id);
}

/** Whether a workspace's code graph is being kept live right now (staleness signal). */
export function isWatching(id: string): boolean {
  return manager.isWatching(id);
}

export async function stopWorkspaceWatchers(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  await manager.stopAll();
}
