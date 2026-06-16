import { db } from "@/lib/db-drizzle";
import { pinned } from "@/lib/api-workspace";
import { deriveFolders, mentionSearch } from "@/lib/mention-search";

export const dynamic = "force-dynamic";

// Backs the node editor's unified @-mention picker: ranks the query across every Beacon entity
// (files + folders from the live code graph, roadmap features, DB tables, endpoints, notes) in one
// round-trip. Read-only; pinned so the editor searches the workspace the browser is viewing.
export const GET = pinned(async (req: Request) => {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (!q.trim()) return Response.json({ hits: [] });

  const [files, features, tables, endpoints, notes] = await Promise.all([
    db.query.codeFile.findMany({ columns: { path: true, lang: true } }),
    db.query.node.findMany({
      where: (n, { eq }) => eq(n.view, "ROADMAP"),
      columns: { id: true, title: true, cluster: true, role: true, plain: true, status: true },
    }),
    db.query.dbTable.findMany({ columns: { name: true, domain: true, description: true } }),
    db.query.endpoint.findMany({
      columns: { id: true, method: true, path: true, domain: true, description: true },
    }),
    db.query.note.findMany({ columns: { id: true, title: true, body: true } }),
  ]);

  const hits = mentionSearch(
    { files, folders: deriveFolders(files.map((f) => f.path)), features, tables, endpoints, notes },
    q,
  );
  return Response.json({ hits });
});
