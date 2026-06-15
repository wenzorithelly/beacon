import { pinned } from "@/lib/api-workspace";
import { getFlag, setFlag } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

// Human-only (browser, pinned) reader/writer for per-workspace feature flags. There is deliberately
// NO MCP twin: the agent cannot flip a flag — e.g. its own scope guard — from the terminal; only
// this settings UI can. Generic over `key`, so future gated features reuse it as-is.
export const GET = pinned(async (req: Request) => {
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return new Response("key required", { status: 400 });
  return Response.json(await getFlag(key));
});

export const POST = pinned(async (req: Request) => {
  const body = (await req.json().catch(() => null)) as
    | { key?: unknown; enabled?: unknown; config?: unknown }
    | null;
  const key = typeof body?.key === "string" ? body.key : "";
  if (!key) return new Response("key required", { status: 400 });
  const data: { enabled?: boolean; config?: Record<string, unknown> } = {};
  if (typeof body?.enabled === "boolean") data.enabled = body.enabled;
  if (body?.config && typeof body.config === "object") data.config = body.config as Record<string, unknown>;
  return Response.json(await setFlag(key, data));
});
