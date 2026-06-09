import { describe, expect, it } from "bun:test";
import { createWatcherManager, type WatchableWorkspace } from "@/intel/watch-manager";

function ws(id: string, path = `/repo/${id}`): WatchableWorkspace {
  return { id, path, name: id };
}

function harness(workspaces: WatchableWorkspace[], opts: { limit?: number; hardCap?: number; missing?: string[] } = {}) {
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
  };
  return { deps, started, stopped, manager: createWatcherManager(deps) };
}

describe("watcher manager", () => {
  it("reconcile starts only the top-N most-recent workspaces", () => {
    const { manager, started } = harness([ws("a"), ws("b"), ws("c")], { limit: 2 });
    manager.reconcile();
    expect(started).toEqual(["a", "b"]);
    expect(manager.isWatching("a")).toBe(true);
    expect(manager.isWatching("c")).toBe(false);
  });

  it("reconcile skips workspaces whose path no longer exists", () => {
    const { manager, started } = harness([ws("a"), ws("b", "/gone/b"), ws("c")], {
      limit: 2,
      missing: ["/gone/b"],
    });
    manager.reconcile();
    expect(started).toEqual(["a", "c"]); // b filtered out, c promoted into the top-2
  });

  it("reconcile stops a watcher whose workspace was removed from the registry", () => {
    const list = [ws("a"), ws("b")];
    const { deps, stopped } = harness(list, { limit: 5 });
    const manager = createWatcherManager(deps);
    manager.reconcile();
    list.splice(1, 1); // drop "b"
    manager.reconcile();
    expect(stopped).toEqual(["b"]);
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
