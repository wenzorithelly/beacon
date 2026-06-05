import { ingestSnapshot } from "@/lib/ingest";
import { writeContextFiles } from "@/lib/context-files";

// The intel daemon POSTs a code-derived snapshot here. Upserts introspected
// tables/endpoints/usages (preserving manual entities + positions) and bumps the
// sync version so open maps refresh.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await ingestSnapshot(body);
    // keep AGENTS.md fresh as the DB map changes — but only if Beacon already manages it
    await writeContextFiles({ onlyIfManaged: true }).catch(() => {});
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return new Response(`Invalid snapshot: ${msg}`, { status: 400 });
  }
}
