import { corsJson, corsPreflight } from "@/lib/feedback/http";
import { parseShareSnapshot, insertSharedBoard } from "@/lib/share-store";
import { SITE_URL } from "@/lib/release";

// Public, deploy-side ingest for shared boards. Every local install posts a snapshot here
// cross-origin (mirrors /api/telemetry); the deploy validates (byte cap + schema + version),
// mints a token, and stores ONE opaque row in the Neon prod DB. NOT workspace-pinned — the
// deploy has no per-workspace data. 503 (not 500) when the DB env is absent so a stray local
// post degrades cleanly. Allowed through proxy.ts in PUBLIC mode.
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return corsPreflight();
}

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  const parsed = parseShareSnapshot(raw);
  if (!parsed.ok) return corsJson({ error: parsed.error }, { status: parsed.status });
  try {
    const { token } = await insertSharedBoard(parsed.snapshot);
    return corsJson({ token, url: `${SITE_URL}/s/${token}` }, { status: 201 });
  } catch {
    return corsJson({ error: "share storage unavailable" }, { status: 503 });
  }
}
