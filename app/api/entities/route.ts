import { db, runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// Lets the Beacon MCP surface the project's planning data to a Claude Code session:
// features (roadmap), architecture components, db tables, endpoints. Pinned to
// the requesting repo so the agent reads ITS workspace, not the browser's active one.
export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), () => handle(req));
}

// Descriptions are truncated by default so the tool result can't overflow the agent's
// context (this used to dump every feature's full `plain` → a ~124k-char result). `full=1`
// returns complete text; `limit=N` caps the row count. For just titles+categories+status the
// lighter beacon_map is preferred.
const PLAIN_PREVIEW = 160;

async function handle(req: Request) {
  const params = new URL(req.url).searchParams;
  const kind = params.get("kind") || "features";

  if (kind === "features" || kind === "architecture") {
    const full = params.get("full") === "1" || params.get("full") === "true";
    const limit = Math.min(Math.max(Number(params.get("limit")) || 0, 0), 500); // 0 = no cap
    const view = kind === "architecture" ? "ARCHITECTURE" : "ROADMAP";
    const all = await db.query.node.findMany({
      where: (t, { eq }) => eq(t.view, view),
      orderBy: (t, { asc }) => [asc(t.cluster), asc(t.y)],
    });
    const nodes = limit > 0 ? all.slice(0, limit) : all;
    return Response.json({
      items: nodes.map((n) => ({
        id: n.id,
        title: n.title,
        cluster: n.cluster,
        status: n.status,
        priority: n.priority,
        layer: n.layer,
        kind: n.kind,
        role: n.role,
        plain:
          full || !n.plain
            ? n.plain
            : n.plain.length > PLAIN_PREVIEW
              ? n.plain.slice(0, PLAIN_PREVIEW) + "…"
              : n.plain,
      })),
    });
  }

  if (kind === "tables") {
    const tables = await db.query.dbTable.findMany({
      with: { columns: { orderBy: (c, { asc }) => asc(c.ord) } },
    });
    return Response.json({
      items: tables.map((t) => ({
        id: t.id,
        name: t.name,
        domain: t.domain,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.type,
          isPk: c.isPk,
          isFk: c.isFk,
          nullable: c.nullable,
          note: c.note,
        })),
      })),
    });
  }

  if (kind === "endpoints") {
    const eps = await db.query.endpoint.findMany();
    return Response.json({
      items: eps.map((e) => ({
        id: e.id,
        method: e.method,
        path: e.path,
        domain: e.domain,
        description: e.description,
      })),
    });
  }

  return new Response("unknown kind (features|architecture|tables|endpoints)", {
    status: 400,
  });
}
