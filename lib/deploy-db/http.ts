// The deploy-side APIs (shared boards + anonymous telemetry) are called cross-origin by every
// distributed install (localhost → the deploy), so a wildcard CORS policy is correct here. Shared
// by those handlers and their OPTIONS preflight. (The pinned-share admin path also sends an
// Authorization/x-beacon-share-token header, but it runs server-side — no browser preflight.)
export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function corsJson(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: { ...CORS, ...(init?.headers ?? {}) },
  });
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
