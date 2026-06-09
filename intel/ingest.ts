import type { Snapshot } from "@/lib/ingest";
import type { CodeGraphInput } from "@/lib/code-graph";
import { BEACON_WS_PATH_HEADER, idForPath } from "@/lib/workspaces";

function workspaceHeaders(explicitWsId?: string): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  // Tell the (multi-workspace) server which repo this snapshot is for, so it writes to
  // that workspace's DB regardless of which one the user currently has active in the UI.
  // An explicit id (passed from the server-side "Sync code map" route) wins; the env
  // BEACON_REPO fallback is for pinned CLI / standalone watcher processes — for those we ALSO send
  // the repo path so the server can self-register the workspace if it isn't known yet (matching how
  // `beacon mcp` registers), instead of the ingest falling back to the browser's active repo.
  if (explicitWsId) h["x-beacon-workspace"] = explicitWsId;
  else if (process.env.BEACON_REPO) {
    h["x-beacon-workspace"] = idForPath(process.env.BEACON_REPO);
    h[BEACON_WS_PATH_HEADER] = process.env.BEACON_REPO;
  }
  return h;
}

export async function postSnapshot(controlUrl: string, snapshot: Snapshot, wsId?: string) {
  const res = await fetch(`${controlUrl}/api/ingest`, {
    method: "POST",
    headers: workspaceHeaders(wsId),
    body: JSON.stringify(snapshot),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

export async function postCodeGraph(controlUrl: string, snapshot: CodeGraphInput, wsId?: string) {
  const res = await fetch(`${controlUrl}/api/code-graph`, {
    method: "POST",
    headers: workspaceHeaders(wsId),
    body: JSON.stringify(snapshot),
  });
  const body = await res.text();
  // The /api/code-graph response carries server-computed counts (circular edges
  // can only be known once we have the whole graph). Surface them through.
  let stats: { files?: number; edges?: number; circular?: number } = {};
  try {
    stats = JSON.parse(body);
  } catch {
    /* server error response — leave stats empty */
  }
  return { ok: res.ok, status: res.status, body, stats };
}
