// The feedback API is called cross-origin by every distributed install (localhost → the deploy),
// and the data is fully public, so a wildcard CORS policy is correct here. Shared by all three
// feedback handlers (GET/POST/vote + their OPTIONS preflight).
export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-feedback-token",
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
