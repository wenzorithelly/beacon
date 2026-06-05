import { ingestSnapshot } from "@/lib/ingest";
import { writeContextFiles } from "@/lib/context-files";
import { getDb } from "@/lib/db";
import { dbUrlFor, getActiveId, getWorkspace } from "@/lib/workspaces";

// The intel daemon POSTs a code-derived snapshot here. Upserts introspected
// tables/endpoints/usages (preserving manual entities + positions) and bumps the
// sync version so open maps refresh. The `x-beacon-workspace` header pins the write to
// the posting repo's workspace, so per-repo watchers never cross-write under one server.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const wsId = req.headers.get("x-beacon-workspace");
    const ws = wsId ? getWorkspace(wsId) : null;
    const result = await ingestSnapshot(body, ws ? getDb(dbUrlFor(ws.id)) : undefined);
    // Regenerate AGENTS.md only for the active repo (repoRoot() points there).
    if (!wsId || wsId === getActiveId()) {
      await writeContextFiles({ onlyIfManaged: true }).catch(() => {});
    }
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return new Response(`Invalid snapshot: ${msg}`, { status: 400 });
  }
}
