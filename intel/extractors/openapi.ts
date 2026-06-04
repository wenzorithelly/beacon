// Deterministic endpoint facts from a framework's OpenAPI spec (FastAPI, ASP.NET,
// axum/utoipa, etc. all emit one). Language-agnostic.

export interface EndpointFact {
  method: string;
  path: string;
  domain: string | null;
  description: string | null;
}

const METHODS = new Set(["get", "post", "put", "patch", "delete"]);

export function parseOpenApi(spec: unknown): EndpointFact[] {
  const out: EndpointFact[] = [];
  const paths = (spec as { paths?: Record<string, Record<string, unknown>> })?.paths ?? {};
  for (const [path, ops] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(ops ?? {})) {
      if (!METHODS.has(method.toLowerCase())) continue;
      const o = op as { tags?: string[]; summary?: string; description?: string };
      out.push({
        method: method.toUpperCase(),
        path,
        domain: o?.tags?.[0] ?? null,
        description: o?.summary ?? o?.description ?? null,
      });
    }
  }
  return out;
}

export async function fetchOpenApi(url?: string): Promise<EndpointFact[]> {
  if (!url) return [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    return parseOpenApi(await res.json());
  } catch {
    return [];
  }
}
