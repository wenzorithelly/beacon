import { resolve } from "node:path";
import type { IntelConfig } from "@/intel/config";
import { scanFiles } from "@/intel/extractors/files";
import { fetchOpenApi } from "@/intel/extractors/openapi";
import { buildCodeGraph } from "@/intel/extractors/code-graph";
import { mergeSnapshot } from "@/intel/merge";
import { postCodeGraph, postSnapshot } from "@/intel/ingest";
import type { Snapshot } from "@/lib/ingest";

/**
 * One sync pass: gather files + OpenAPI facts → merge deterministically →
 * POST to the control app. Graceful at every step.
 *
 * `targetWorkspaceId` pins every POST to a specific Beacon workspace via the
 * x-beacon-workspace header — required when the pipeline runs from inside the
 * Next.js server (the "Sync code map" button), where the BEACON_REPO env that
 * the standalone watcher uses isn't set. Without a pin, /api/code-graph and
 * /api/ingest fall back to the currently active workspace and a dropdown switch
 * mid-sync would land the writes in the wrong DB.
 */
export async function runPipeline(config: IntelConfig, targetWorkspaceId?: string) {
  const seen = new Set<string>();
  const files = config.roots
    .flatMap((r) =>
      scanFiles(resolve(config.configDir, r), {
        maxFiles: config.llm.maxFiles,
        maxBytes: config.llm.maxBytes,
      }),
    )
    .filter((f) => (seen.has(f.path) ? false : (seen.add(f.path), true)));

  const endpointFacts = await fetchOpenApi(config.openapiUrl);

  const base: Snapshot = {
    tables: [],
    relations: [],
    endpoints: endpointFacts.map((e) => ({
      method: e.method,
      path: e.path,
      domain: e.domain,
      description: e.description,
      uses: [],
    })),
  };
  const snapshot = mergeSnapshot(base, endpointFacts);

  const res = await postSnapshot(config.controlUrl, snapshot, targetWorkspaceId);

  // Code graph — runs every tick. Scans ALL configured roots into one merged,
  // base-relative graph (monorepo support).
  let codeGraph: { files: number; edges: number; circular: number } | null = null;
  try {
    const roots = config.roots.map((r) => resolve(config.configDir, r));
    const graph = await buildCodeGraph(roots);
    const r = await postCodeGraph(config.controlUrl, graph, targetWorkspaceId);
    if (r.ok) {
      codeGraph = {
        files: r.stats.files ?? graph.files.length,
        edges: r.stats.edges ?? graph.edges.length,
        circular: r.stats.circular ?? 0,
      };
    } else console.error("[intel] code-graph post failed:", r.status, r.body);
  } catch (e) {
    console.error("[intel] code-graph error:", e instanceof Error ? e.message : e);
  }

  return {
    ok: res.ok,
    files: files.length,
    tables: snapshot.tables?.length ?? 0,
    endpoints: snapshot.endpoints?.length ?? 0,
    codeFiles: codeGraph?.files ?? 0,
    codeEdges: codeGraph?.edges ?? 0,
    codeCircular: codeGraph?.circular ?? 0,
    status: res.status,
    body: res.body,
  };
}
