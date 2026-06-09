import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { join, resolve } from "node:path";
import { createCodeGraphBuilder } from "@/intel/extractors/code-graph";
import { ingestCodeGraph } from "@/lib/code-graph";
import { getDb } from "@/lib/db-drizzle";
import { dbUrlFor, ensureWorkspaceDb } from "@/lib/workspaces";

// Per-workspace in-process code-graph watcher. The manager (intel/watch-manager.ts)
// starts one of these per active repo. Each pins its writes to its OWN workspace DB —
// never the dropdown-active one — so a save in repo A can never corrupt repo B's graph.
// Code-graph only (cheap, deterministic, no AI); the standalone intel/watch.ts still
// owns the AI DB/endpoints pipeline. Both writers are idempotent so co-running is safe.

const IGNORE =
  /[/\\](node_modules|\.git|\.next|dist|build|__pycache__|target|\.venv|venv|\.beacon|\.playwright-mcp|generated|coverage)[/\\]/;

interface WatchTarget {
  id: string;
  path: string;
  name: string;
}

/** Configured roots for a repo: beacon.config.json `roots` if present, else the repo itself. */
function rootsForRepo(repoPath: string): string[] {
  try {
    const cfgPath = join(repoPath, "beacon.config.json");
    if (existsSync(cfgPath)) {
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      if (Array.isArray(cfg.roots) && cfg.roots.length) {
        return cfg.roots.map((r: string) => resolve(repoPath, r));
      }
    }
  } catch {
    /* malformed config — fall back to the repo root */
  }
  return [repoPath];
}

/** Start a live, incremental code-graph watcher for one workspace. */
export function startWatcherForWorkspace(ws: WatchTarget): { stop: () => Promise<void> } {
  const roots = rootsForRepo(ws.path);
  // Provision/migrate in the background and await it before the first ingest (below) so a brand-new
  // or migration-behind db is ready when the watcher's first tick writes. Cached per process → cheap.
  const dbReady = ensureWorkspaceDb(ws.id);
  const targetDb = getDb(dbUrlFor(ws.id));

  // One builder for the watcher's lifetime — its specifier cache makes each tick
  // incremental (only changed files are re-read). Base = repo path → repo-relative paths.
  const builder = createCodeGraphBuilder(roots, ws.path);
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  async function run() {
    if (running) {
      schedule();
      return;
    }
    running = true;
    try {
      await dbReady;
      const graph = await builder.build();
      const r = await ingestCodeGraph(graph, targetDb);
      console.log(
        `[beacon-inline] code-graph synced (${ws.name}): ${r.files} files / ${r.edges} imports${
          r.circular > 0 ? ` (${r.circular} circular)` : ""
        }`,
      );
    } catch (e) {
      console.error(`[beacon-inline] error (${ws.name}):`, e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  }

  function schedule() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(run, 600);
  }

  // Native recursive fs.watch — registers INSTANTLY with no initial tree scan. chokidar's
  // startup walked the tree to set up per-dir watches, which blocked the daemon's event loop
  // for hundreds of ms per repo (≈600ms on this repo) — the dominant warm-up stall. On macOS
  // it's backed by FSEvents (the whole subtree, node_modules included, watched in the kernel
  // for free; we just FILTER churny paths out of the rebuild trigger). Recursive watching is a
  // macOS/Windows feature; on Linux `watch(..,{recursive:true})` throws, so we degrade to "no
  // live graph" rather than fall back to a blocking scanner (intel/watch.ts still uses chokidar
  // out-of-process, where blocking can't stall the daemon).
  const watchers: FSWatcher[] = [];
  for (const root of roots) {
    try {
      const w = watch(root, { recursive: true, persistent: true }, (_event, filename) => {
        // filename is root-relative (or null). Skip events from ignored dirs; otherwise the
        // incremental rebuild (debounced) re-reads only what actually changed.
        if (filename && IGNORE.test(`/${filename}`)) return;
        schedule();
      });
      w.on("error", (e) => console.error(`[beacon-inline] watcher error (${ws.name}):`, e));
      watchers.push(w);
    } catch (e) {
      // Recursive fs.watch unavailable (e.g. Linux) — skip the live watch; the graph stays
      // whatever the last manual sync produced. Never throw out of a watcher start.
      console.error(
        `[beacon-inline] live watch unavailable for ${root} (${ws.name}):`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  // No "ready" phase with fs.watch (nothing is scanned) — kick off the initial extract now.
  console.log(`[beacon-inline] watching ${ws.name} (${roots.join(", ")}) — initial extract…`);
  void run();

  return {
    async stop() {
      if (debounce) clearTimeout(debounce);
      for (const w of watchers) w.close();
    },
  };
}
