import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import chokidar from "chokidar";
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
      const graph = builder.build();
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

  const watcher = chokidar.watch(roots, {
    ignored: (p: string) => IGNORE.test(p),
    ignoreInitial: true,
    persistent: true,
  });

  watcher.on("ready", () => {
    console.log(`[beacon-inline] watching ${ws.name} (${roots.join(", ")}) — initial extract…`);
    void run();
  });
  watcher.on("all", () => schedule());
  watcher.on("error", (e) => console.error(`[beacon-inline] watcher error (${ws.name}):`, e));

  return {
    async stop() {
      if (debounce) clearTimeout(debounce);
      await watcher.close();
    },
  };
}
