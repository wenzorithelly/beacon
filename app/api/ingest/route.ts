import { ingestSnapshot } from "@/lib/ingest";
import { writeContextFiles } from "@/lib/context-files";
import {
  BEACON_WS_PATH_HEADER,
  getActiveId,
  resolveRequestWorkspaceId,
  runWithWorkspace,
} from "@/lib/workspaces";

// The intel daemon POSTs a code-derived snapshot here. Upserts introspected tables/endpoints/usages
// (preserving manual entities + positions) and bumps the sync version so open maps refresh.
//
// This is an AGENT/WATCHER-only route, so it must never write to whatever the BROWSER has active:
// resolveRequestWorkspaceId pins the write to the posting repo (header id, or self-register from the
// repo PATH header). If a workspace WAS named but can't be resolved we fail closed (400) rather than
// silently falling back to the active repo — the cross-workspace write this closes. A header-LESS
// post (the intentional single-workspace standalone watcher) still targets the active repo.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const namedWorkspace = !!(
      req.headers.get("x-beacon-workspace") || req.headers.get(BEACON_WS_PATH_HEADER)
    );
    const id = await resolveRequestWorkspaceId(req);
    if (namedWorkspace && !id) return new Response("unknown workspace", { status: 400 });

    return await runWithWorkspace(id, async () => {
      const result = await ingestSnapshot(body); // the `db` proxy is now ALS-pinned to `id`
      // Regenerate AGENTS.md only for the active repo (repoRoot() points there).
      if (!id || id === getActiveId()) {
        await writeContextFiles({ onlyIfManaged: true }).catch(() => {});
      }
      return Response.json({ ok: true, ...result });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return new Response(`Invalid snapshot: ${msg}`, { status: 400 });
  }
}
