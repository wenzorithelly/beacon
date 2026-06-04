import type { Snapshot } from "@/lib/ingest";
import type { EndpointFact } from "@/intel/extractors/openapi";

const key = (m: string, p: string) => `${m} ${p}`;

/**
 * Merges deterministic OpenAPI endpoint facts into the AI snapshot. When the dev
 * server is up, OpenAPI is authoritative for the endpoint list (method/path/domain);
 * the AI still supplies the table-usage edges. When no OpenAPI, the AI's endpoints stand.
 */
export function mergeSnapshot(ai: Snapshot, endpointFacts: EndpointFact[]): Snapshot {
  if (!endpointFacts.length) return ai;

  const aiByKey = new Map((ai.endpoints ?? []).map((e) => [key(e.method, e.path), e]));
  const factKeys = new Set(endpointFacts.map((f) => key(f.method, f.path)));

  const merged = endpointFacts.map((f) => {
    const aiEp = aiByKey.get(key(f.method, f.path));
    return {
      method: f.method,
      path: f.path,
      domain: f.domain ?? aiEp?.domain ?? null,
      description: f.description ?? aiEp?.description ?? null,
      uses: aiEp?.uses ?? [],
    };
  });

  // keep AI-found endpoints the server doesn't expose yet (e.g. just written)
  for (const e of ai.endpoints ?? []) {
    if (!factKeys.has(key(e.method, e.path))) merged.push(e);
  }

  return { ...ai, endpoints: merged };
}
