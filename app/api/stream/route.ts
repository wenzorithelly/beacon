import { getVersion } from "@/lib/ingest";
import { boardRevisions, type BoardRevisions } from "@/lib/board-revision";
import { runWithWorkspace } from "@/lib/db-drizzle";
import { getWorkspace, workspaceIdFromRequest } from "@/lib/workspaces";
import { recordTabPresence } from "@/lib/tab-presence";
import { recordDesktopTabPresence } from "@/lib/desktop-tab";
import { readNavIntent } from "@/lib/nav-intent";

export const dynamic = "force-dynamic";

// Server-Sent Events: pushes a JSON `{ v, nav, rev }` payload whenever the sync version OR a
// nav-intent changes. `v` (the SyncState version) drives live-refresh on every ingest; `rev`
// says WHICH boards that bump touched (lib/board-revision.ts) so the client can reconcile one
// board instead of reloading the page — a bump with no attributable board still falls back to
// the full refresh. `nav` carries either a "navigate this tab" intent (the `beacon` CLI writes one
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
  const url = new URL(req.url);
  const wsParam = url.searchParams.get("ws");
  const wsId = wsParam && getWorkspace(wsParam) ? wsParam : workspaceIdFromRequest(req);
  // `?client=desktop` — the EventSource self-identifies as the desktop shell's web view (set by
  // components/live-refresh.tsx only when isDesktopShell()). Each tick then ALSO beats the GLOBAL
  // desktop-tab record (lib/desktop-tab.ts) with the workspace this stream is pinned to, so the
  // plan-open routing knows the app is open — and WHERE to write a cross-workspace nav-intent.
  const isDesktopClient = url.searchParams.get("client") === "desktop";

  const stream = new ReadableStream({
    async start(controller) {
      let lastV = -1;
      let lastNavSeq = -1;
      // Last computed fingerprints, refreshed only on a version change and re-sent verbatim on a
      // nav-only frame — so the steady-state poll stays the single getVersion() read it is today.
      let rev: BoardRevisions = {};
      controller.enqueue(encoder.encode("retry: 2000\n\n"));
      const tick = async () => {
        if (closed) return;
        try {
          const { v, nextRev, navSeq, navPath, navPark, navExcludeTab } = await runWithWorkspace(
            wsId,
            async () => {
              const now = Date.now();
              recordTabPresence(now);
              // wsId can be null (no ?ws, no cookie): record a blank ws — the routing then
              // falls back to targeting the plan's own workspace (chooseReviewRoute).
              if (isDesktopClient) recordDesktopTabPresence(now, wsId ?? "");
              const nav = readNavIntent();
              const version = await getVersion();
              return {
                v: version,
                nextRev: version === lastV ? null : await boardRevisions(),
                navSeq: nav?.seq ?? 0,
                navPath: nav?.path ?? "",
                navPark: nav?.park ?? false,
                navExcludeTab: nav?.excludeTab ?? "",
              };
            },
          );
          if (nextRev) rev = nextRev;
          if (v !== lastV || navSeq !== lastNavSeq) {
            lastV = v;
            lastNavSeq = navSeq;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  v,
                  nav: { seq: navSeq, path: navPath, park: navPark, excludeTab: navExcludeTab },
                  rev,
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
