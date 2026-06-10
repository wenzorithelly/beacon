import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createIncrementalCodeGraph } from "@/intel/extractors/code-graph";
import { deriveEndpointUses } from "@/intel/extractors/endpoint-uses";
import { extractModelSchema } from "@/intel/extractors/models";
import { extractNextRoutes } from "@/intel/extractors/next-routes";
import type { SourceFile } from "@/intel/extractors/files";
import { isSchemaCandidate, schemaCandidates } from "@/intel/schema-candidates";
import {
  applyCodeGraphPatch,
  ingestCodeGraph,
  resolveGraph,
  type ResolvedGraph,
} from "@/lib/code-graph";
import { ingestSnapshot } from "@/lib/ingest";
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

  // Event-driven incremental graph: seed() walks ONCE; thereafter each change re-reads only
  // the one file that changed (mtime-gated) and we persist a MINIMAL DB diff — no re-walk and
  // no full re-ingest per save. `prev` is the stored representation (mirrors the DB).
  const graph = createIncrementalCodeGraph(roots, ws.path);

  // Deterministic DB-board sync: parse ORM models + Next route files (a handful, already
  // known from the graph's file list) and upsert tables/endpoints as INTROSPECTION — so a
  // table/endpoint the agent just implemented flips to "live" without an AI pass. Partial
  // ingest: a repo without recognizable models (or routes) leaves that section untouched.
  async function syncSchema(): Promise<void> {
    const rels = schemaCandidates(graph.snapshot().files.map((f) => f.path));
    // schema.prisma isn't a code-graph language, so the walk never lists it — probe directly.
    for (const root of roots) {
      for (const probe of ["prisma/schema.prisma", "schema.prisma"]) {
        const abs = join(root, probe);
        if (existsSync(abs)) rels.push(toRel(abs));
      }
    }
    const files: SourceFile[] = [];
    for (const rel of rels) {
      try {
        files.push({ path: rel, content: await readFile(join(ws.path, rel), "utf8") });
      } catch {
        /* vanished — skip */
      }
    }
    const det = extractModelSchema(files);
    const endpoints = extractNextRoutes(files);
    if (!det.tables.length && !endpoints.length) return;

    // Endpoint→table links, also deterministic: scan each route's import radius (live code
    // graph) for the Drizzle table variables the model extractor reported, so the board
    // draws real connections instead of orphan endpoint pills.
    if (endpoints.length && det.tableVars && Object.keys(det.tableVars).length) {
      const snap = graph.snapshot();
      const adjacency = snap.edges;
      // Preload every file the radius walk can touch (route + 2 hops), once per pass.
      const wanted = new Set<string>(endpoints.map((e) => e.file));
      const adj = new Map<string, string[]>();
      for (const e of adjacency) {
        const l = adj.get(e.from) ?? [];
        l.push(e.to);
        adj.set(e.from, l);
      }
      for (let d = 0; d < 2; d++) {
        for (const f of [...wanted]) for (const to of adj.get(f) ?? []) wanted.add(to);
      }
      const contents = new Map<string, string>();
      for (const rel of [...wanted].slice(0, 600)) {
        try {
          contents.set(rel, await readFile(join(ws.path, rel), "utf8"));
        } catch {
          /* vanished — skip */
        }
      }
      const uses = deriveEndpointUses({
        routeFiles: [...new Set(endpoints.map((e) => e.file))],
        edges: adjacency,
        content: (p) => contents.get(p) ?? null,
        tableVars: det.tableVars,
      });
      for (const e of endpoints) e.uses = uses.get(e.file) ?? [];
    }

    const r = await ingestSnapshot(
      { tables: det.tables, relations: det.relations, endpoints },
      targetDb,
      { partial: true },
    );
    console.log(
      `[beacon-inline] schema synced (${ws.name}): ${r.tables} tables / ${r.endpoints} endpoints`,
    );
  }
  function toRel(abs: string): string {
    return relative(ws.path, abs).split(/[\\/]/).join("/");
  }
  let prev: ResolvedGraph | null = null; // null → (re)seed needed
  let needsReseed = false; // set when an event arrives without a filename (unknown change)
  const pending = new Set<string>(); // absolute paths reported changed since the last run
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
      if (needsReseed) {
        prev = null;
        needsReseed = false;
      }
      if (prev === null) {
        // Full seed: the one tree walk + a full ingest (correct even if the DB already has rows).
        const snap = await graph.seed();
        const r = await ingestCodeGraph(snap, targetDb);
        prev = resolveGraph(snap);
        console.log(
          `[beacon-inline] code-graph synced (${ws.name}): ${r.files} files / ${r.edges} imports${
            r.circular > 0 ? ` (${r.circular} circular)` : ""
          }`,
        );
        await syncSchema();
        return;
      }
      // Incremental: re-read only the files that changed, then persist a minimal diff.
      const changed = [...pending];
      pending.clear();
      // A model/route file save must re-sync the DB board even when the import graph is
      // unchanged (schema.prisma isn't even a graph language) — decide before the gate.
      const schemaTouched = changed.some((abs) => isSchemaCandidate(toRel(abs)));
      let touched = false;
      for (const abs of changed) if (await graph.applyChange(abs)) touched = true;
      if (touched) {
        const next = resolveGraph(graph.snapshot());
        const r = await applyCodeGraphPatch(prev, next, targetDb);
        prev = next;
        console.log(
          `[beacon-inline] code-graph updated (${ws.name}): ${r.files} files / ${r.edges} imports${
            r.circular > 0 ? ` (${r.circular} circular)` : ""
          }`,
        );
      }
      if (schemaTouched) await syncSchema();
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
        // filename is root-relative (or null on some platforms). Record the exact path that
        // changed so the run re-reads ONLY that file; a missing filename forces a full reseed.
        if (!filename) {
          needsReseed = true;
          schedule();
          return;
        }
        const rel = String(filename);
        if (IGNORE.test(`/${rel}`)) return; // skip churny dirs (node_modules, .git, …)
        pending.add(join(root, rel));
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
