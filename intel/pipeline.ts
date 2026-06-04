import { resolve } from "node:path";
import type { IntelConfig } from "@/intel/config";
import { scanFiles } from "@/intel/extractors/files";
import { fetchOpenApi } from "@/intel/extractors/openapi";
import { extractGraph, type Provider } from "@/intel/extract";
import { fetchSettings } from "@/intel/settings";
import { mergeSnapshot } from "@/intel/merge";
import { postSnapshot } from "@/intel/ingest";
import type { Snapshot } from "@/lib/ingest";

/**
 * One sync pass: gather files + OpenAPI facts → ask Claude for the semantic graph
 * (if a key is set) → merge → POST to the control app. Graceful at every step.
 */
export async function runPipeline(config: IntelConfig) {
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

  // The model/provider chosen in the control-app UI override the config defaults.
  const remote = await fetchSettings(config.controlUrl);
  const effective = remote
    ? { ...config, llm: { ...config.llm, model: remote.intelModel, provider: remote.intelProvider } }
    : config;

  let ai: Snapshot | null = null;
  let provider: Provider = "none";
  try {
    const r = await extractGraph(files, endpointFacts, effective);
    ai = r.snapshot;
    provider = r.provider;
  } catch (e) {
    console.error("[intel] AI error:", e instanceof Error ? e.message : e);
  }

  const base: Snapshot =
    ai ?? {
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

  const res = await postSnapshot(config.controlUrl, snapshot);
  return {
    ok: res.ok,
    provider,
    model: effective.llm.model,
    aiUsed: ai != null,
    files: files.length,
    tables: snapshot.tables?.length ?? 0,
    endpoints: snapshot.endpoints?.length ?? 0,
    status: res.status,
    body: res.body,
  };
}
