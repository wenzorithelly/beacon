import { ingestSymbolGraph } from "@/lib/symbol-graph";
import {
  BEACON_WS_PATH_HEADER,
  resolveRequestWorkspaceId,
  runWithWorkspace,
} from "@/lib/workspaces";

// The out-of-process seam for a full symbol-graph snapshot — the symbol-layer twin of
// /api/code-graph, for a watcher that runs OUTSIDE the daemon. The in-process watcher
// (intel/watch-inline.ts) does not come through here: it patches its own workspace db directly,
// and a full replace posted underneath it would leave its in-memory snapshot describing rows that
// are gone. Nothing in this repo posts here yet. Same workspace-resolution contract as
// /api/code-graph: a named-but-unresolvable workspace fails closed (400) rather than silently
// falling back to the browser's active repo.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const namedWorkspace = !!(
      req.headers.get("x-beacon-workspace") || req.headers.get(BEACON_WS_PATH_HEADER)
    );
    const id = await resolveRequestWorkspaceId(req);
    if (namedWorkspace && !id) return new Response("unknown workspace", { status: 400 });

    const result = await runWithWorkspace(id, () => ingestSymbolGraph(body));
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return new Response(`Invalid symbol-graph snapshot: ${msg}`, { status: 400 });
  }
}
