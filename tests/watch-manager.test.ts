import { describe, expect, it } from "bun:test";
import { createWatcherManager, type WatchableWorkspace } from "@/intel/watch-manager";

function ws(id: string, path = `/repo/${id}`): WatchableWorkspace {
  return { id, path, name: id };
}

// reconcile() staggers boot-time starts after the first — tests run with staggerMs: 0
// and flush() a couple of real event-loop ticks to let the deferred ones fire.
function flush(ms = 5): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function harness(
  workspaces: WatchableWorkspace[],
  opts: { limit?: number; hardCap?: number; missing?: string[]; staggerMs?: number } = {},
) {
  const started: string[] = [];
  const stopped: string[] = [];
  const deps = {
    list: () => workspaces.slice(),
    get: (id: string) => workspaces.find((w) => w.id === id) ?? null,
    exists: (p: string) => !(opts.missing ?? []).includes(p),
    start: (w: WatchableWorkspace) => {
      started.push(w.id);
      return { stop: async () => { stopped.push(w.id); } };
    },
    limit: opts.limit,
    hardCap: opts.hardCap,
    staggerMs: opts.staggerMs ?? 0,
  };
  return { deps, started, stopped, manager: createWatcherManager(deps) };
}

describe("watcher manager", () => {
  it("reconcile starts only the top-N most-recent workspaces", async () => {
    const { manager, started } = harness([ws("a"), ws("b"), ws("c")], { limit: 2 });
    manager.reconcile();
    await flush();
    expect(started).toEqual(["a", "b"]);
    expect(manager.isWatching("a")).toBe(true);
    expect(manager.isWatching("c")).toBe(false);
  });

  it("reconcile skips workspaces whose path no longer exists", async () => {
    const { manager, started } = harness([ws("a"), ws("b", "/gone/b"), ws("c")], {
      limit: 2,
      missing: ["/gone/b"],
    });
    manager.reconcile();
    await flush();
    expect(started).toEqual(["a", "c"]); // b filtered out, c promoted into the top-2
  });

  it("reconcile stops a watcher whose workspace was removed from the registry", async () => {
    const list = [ws("a"), ws("b")];
    const { deps, stopped } = harness(list, { limit: 5 });
    const manager = createWatcherManager(deps);
    manager.reconcile();
    await flush(); // let b's staggered start actually happen before it's removed
    list.splice(1, 1); // drop "b"
    manager.reconcile();
    expect(stopped).toEqual(["b"]);
    expect(manager.isWatching("b")).toBe(false);
  });

  it("reconcile cancels a still-pending staggered start if the workspace drops out of the top-N first", async () => {
    const list = [ws("a"), ws("b"), ws("c")];
    const { deps, started } = harness(list, { limit: 2, staggerMs: 20 });
    const manager = createWatcherManager(deps);
    manager.reconcile(); // a starts now, b is scheduled 20ms out
    list.splice(1, 1); // drop "b" before its timer fires
    manager.reconcile(); // top-2 is now [a, c] — c takes b's old slot
    await flush(50);
    expect(started).toEqual(["a", "c"]); // b's stale timer never fired
    expect(manager.isWatching("b")).toBe(false);
  });

  it("ensureWatcher lazily starts a queried repo outside the top-N (idempotently)", () => {
    const { manager, started } = harness([ws("a"), ws("b"), ws("c")], { limit: 1 });
    manager.reconcile();
    expect(started).toEqual(["a"]);
    manager.ensureWatcher("c");
    expect(started).toEqual(["a", "c"]);
    manager.ensureWatcher("c"); // already watching — no-op
    expect(started).toEqual(["a", "c"]);
  });

  it("ensureWatcher is a no-op for unknown ids or missing paths", () => {
    const { manager, started } = harness([ws("a"), ws("b", "/gone/b")], { missing: ["/gone/b"] });
    manager.ensureWatcher("nope");
    manager.ensureWatcher("b");
    expect(started).toEqual([]);
  });

  it("stopWatcher stops one running watcher immediately", async () => {
    const { manager, stopped } = harness([ws("a"), ws("b")], { limit: 5 });
    manager.reconcile();
    await flush();
    await manager.stopWatcher("a");
    expect(stopped).toEqual(["a"]);
    expect(manager.isWatching("a")).toBe(false);
    expect(manager.isWatching("b")).toBe(true);
  });

  it("stopWatcher is a no-op for unknown or never-started ids", async () => {
    const { manager, stopped } = harness([ws("a")], { limit: 0 });
    await manager.stopWatcher("a"); // registered but never started
    await manager.stopWatcher("nope"); // not registered at all
    expect(stopped).toEqual([]);
  });

  it("a stopped workspace can be re-started by ensureWatcher (fresh handle)", async () => {
    const { manager, started, stopped } = harness([ws("a")], { limit: 5 });
    manager.reconcile();
    await manager.stopWatcher("a");
    expect(stopped).toEqual(["a"]);
    manager.ensureWatcher("a");
    expect(started).toEqual(["a", "a"]); // a second, fresh start
    expect(manager.isWatching("a")).toBe(true);
  });

  it("evicts the least-recently-used lazy watcher when the hard cap is hit", () => {
    const { manager, stopped } = harness([ws("w0"), ws("w1"), ws("w2")], { limit: 0, hardCap: 2 });
    manager.ensureWatcher("w0");
    manager.ensureWatcher("w1");
    manager.ensureWatcher("w2"); // over cap → evict LRU (w0), then start w2
    expect(stopped).toContain("w0");
    expect(manager.isWatching("w0")).toBe(false);
    expect(manager.isWatching("w2")).toBe(true);
  });
});
