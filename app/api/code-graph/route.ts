import { ingestCodeGraph } from "@/lib/code-graph";
import {
  BEACON_WS_PATH_HEADER,
  resolveRequestWorkspaceId,
  runWithWorkspace,
} from "@/lib/workspaces";

// The intel watcher POSTs the full file-import snapshot here. Like /api/ingest, this is an
// AGENT/WATCHER-only route: the write is pinned to the posting repo (header id, or self-register from
// the repo PATH header), and a named-but-unresolvable workspace fails closed (400) instead of falling
// back to the browser's active repo. A header-LESS post (single-workspace standalone watcher) targets
// the active repo as before.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const namedWorkspace = !!(
      req.headers.get("x-beacon-workspace") || req.headers.get(BEACON_WS_PATH_HEADER)
    );
    const id = await resolveRequestWorkspaceId(req);
    if (namedWorkspace && !id) return new Response("unknown workspace", { status: 400 });

    const result = await runWithWorkspace(id, () => ingestCodeGraph(body));
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return new Response(`Invalid code-graph snapshot: ${msg}`, { status: 400 });
  }
}
