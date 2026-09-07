import { affectedBy, buildGraph, explainNode, graphStats, queryGraph, shortestPath } from "@/lib/graph-query";
import { db } from "@/lib/db-drizzle";
import { pinned } from "@/lib/api-workspace";
import { getActiveId, resolveRequestWorkspaceId } from "@/lib/workspaces";
import { ensureWatcher } from "@/intel/watch-manager";

// Symbol-graph query surface for `beacon query|explain|affected|path|stats` (bin/graph.ts) and the
// `beacon_graph` MCP tool. Every branch returns a `text` field — that's what the CLI prints
// verbatim, so it stays human-readable even on a 400/503.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SYNC_POLL_MS = 250;
// Read per-request (not a module-level const) so a test can shrink it via env instead of
// burning 15 real seconds to exercise the 503 path.
const syncTimeoutMs = () => Number(process.env.BEACON_GRAPH_SYNC_TIMEOUT_MS) || 15_000;

async function symbolGraphSyncedAt(): Promise<Date | null> {
  const s = await db.query.syncState.findFirst({
    where: (t, { eq }) => eq(t.id, "singleton"),
    columns: { symbolGraphSyncedAt: true },
  });
  return s?.symbolGraphSyncedAt ?? null;
}

function badRequest(error: string, text: string, extra?: Record<string, unknown>) {
  return Response.json({ error, text, ...extra }, { status: 400 });
}

// `pinned`, not the sync `workspaceIdFromRequest`: the first `beacon query` from a repo Beacon has
// never seen arrives with only the path header, and this is the call that must register it and
// provision its db — exactly what the POST ingest route does for the watcher's first push.
export const GET = pinned(handle);

async function handle(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "query";
  const q = url.searchParams.get("q");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const mode = url.searchParams.get("mode") === "dfs" ? "dfs" : "bfs";
  const depthRaw = Number(url.searchParams.get("depth"));
  const depth = Number.isFinite(depthRaw) && depthRaw > 0 ? depthRaw : undefined;
  const budgetRaw = Number(url.searchParams.get("budget"));
  const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : undefined;
  const undirected = ["1", "true"].includes(url.searchParams.get("undirected") ?? "");

  if (action === "query" && !q) return badRequest("missing q", "Missing required ?q= (the free-text question).");
  if ((action === "explain" || action === "affected") && !q) {
    return badRequest("missing q", `Missing required ?q= (the symbol name to ${action}).`);
  }
  if (action === "path" && (!from || !to)) return badRequest("missing from/to", "Missing required ?from= and ?to= (symbol names).");

  // Warm this repo's watcher (no-op if already watching), then wait for its FIRST symbol-graph
  // tick — a cold repo has no rows yet, and answering against an empty graph is worse than a
  // short wait. wsId can be null in a single-workspace-less context; ensureWatcher needs a real id.
  const wsId = (await resolveRequestWorkspaceId(req)) ?? getActiveId();
  if (wsId) ensureWatcher(wsId);
  let syncedAt = await symbolGraphSyncedAt();
  const deadline = Date.now() + syncTimeoutMs();
  while (!syncedAt && Date.now() < deadline) {
    await sleep(SYNC_POLL_MS);
    syncedAt = await symbolGraphSyncedAt();
  }
  if (!syncedAt) {
    return Response.json(
      { error: "indexing", text: "Beacon is still indexing this repo's symbols — retry in a few seconds." },
      { status: 503 },
    );
  }

  // ponytail: loads the whole graph per request — cache on symbolGraphSyncedAt if that ever shows in a profile
  const [symbols, symbolEdges, files, fileEdges] = await Promise.all([
    db.query.codeSymbol.findMany(),
    db.query.codeSymbolEdge.findMany(),
    db.query.codeFile.findMany(),
    db.query.codeFileEdge.findMany(),
  ]);
  const g = buildGraph({ symbols, symbolEdges, files, fileEdges });
  // Synced-but-empty is a real state (no supported language, or the grammars failed to load —
  // the daemon logs "[symbols] …" once when that happens). Say so, instead of a confident
  // "0 symbols" answer built from file nodes alone.
  if (symbols.length === 0 && action !== "stats") {
    return Response.json(
      {
        ok: false,
        error: "empty",
        text: "No symbols are indexed for this workspace (supported: ts/tsx/js, py, go, rs). If the repo has them, check the daemon log for a \"[symbols]\" line.",
      },
      { status: 404 },
    );
  }

  let result:
    | ReturnType<typeof queryGraph>
    | ReturnType<typeof explainNode>
    | ReturnType<typeof affectedBy>
    | ReturnType<typeof shortestPath>
    | ReturnType<typeof graphStats>;
  switch (action) {
    case "stats":
      result = graphStats(g);
      break;
    case "explain":
      result = explainNode(g, q!);
      break;
    case "affected":
      result = affectedBy(g, q!, { depth });
      break;
    case "path":
      result = shortestPath(g, from!, to!, { undirected });
      break;
    case "query":
      result = queryGraph(g, q!, { mode, depth, budget });
      break;
    default:
      return badRequest("unknown action", `Unknown action "${action}". Use query | explain | affected | path | stats.`);
  }

  if ("notFound" in result || "ambiguous" in result) {
    return badRequest(
      "notFound" in result ? "not_found" : "ambiguous",
      result.text,
      "ambiguous" in result ? { ambiguous: result.ambiguous } : undefined,
    );
  }
  return Response.json({ ok: true, action, syncedAt: syncedAt.toISOString(), ...result });
}
