import { getVersion } from "@/lib/ingest";
import { runWithWorkspace } from "@/lib/db-drizzle";
import { getWorkspace, workspaceIdFromRequest } from "@/lib/workspaces";
import { recordTabPresence } from "@/lib/tab-presence";
import { readNavIntent } from "@/lib/nav-intent";

export const dynamic = "force-dynamic";

// Server-Sent Events: pushes a JSON `{ v, nav }` payload whenever the sync version OR a
// nav-intent changes. `v` (the SyncState version) drives live-refresh's router.refresh() on
// every ingest; `nav` carries either a "navigate this tab" intent (the `beacon` CLI writes one
// when it reuses an already-open tab instead of opening a new one) or a "park this tab" intent
// (written via /api/tab/park to ask a forgotten tab to unmount and free memory — optionally
// excluding one self-identified tab via `excludeTab`, see lib/tab-id.ts). Each tick ALSO records
// tab-presence — an open stream IS a live tab — which is exactly what the CLI checks before
// opening.
export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let closed = false;
  // Pin every tick to THIS tab's workspace. The per-tab `?ws=` param wins (so a tab pinned to
  // workspace A keeps streaming A even after the browser-wide beacon_ws cookie drifts to B when
  // another repo is opened); otherwise fall back to the cookie / agent-header resolution.
  // Captured here and re-applied per tick — the setTimeout loop outlives the request's context.
  const wsParam = new URL(req.url).searchParams.get("ws");
  const wsId = wsParam && getWorkspace(wsParam) ? wsParam : workspaceIdFromRequest(req);

  const stream = new ReadableStream({
    async start(controller) {
      let lastV = -1;
      let lastNavSeq = -1;
      controller.enqueue(encoder.encode("retry: 2000\n\n"));
      const tick = async () => {
        if (closed) return;
        try {
          const { v, navSeq, navPath, navPark, navExcludeTab } = await runWithWorkspace(
            wsId,
            async () => {
              recordTabPresence(Date.now());
              const nav = readNavIntent();
              return {
                v: await getVersion(),
                navSeq: nav?.seq ?? 0,
                navPath: nav?.path ?? "",
                navPark: nav?.park ?? false,
                navExcludeTab: nav?.excludeTab ?? "",
              };
            },
          );
          if (v !== lastV || navSeq !== lastNavSeq) {
            lastV = v;
            lastNavSeq = navSeq;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  v,
                  nav: { seq: navSeq, path: navPath, park: navPark, excludeTab: navExcludeTab },
                })}\n\n`,
              ),
            );
          }
        } catch {
          // ignore transient DB errors; keep the stream alive
        }
        if (!closed) setTimeout(tick, 1000);
      };
      void tick();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
