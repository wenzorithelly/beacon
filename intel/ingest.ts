import type { Snapshot } from "@/lib/ingest";
import { idForPath } from "@/lib/workspaces";

export async function postSnapshot(controlUrl: string, snapshot: Snapshot) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Tell the (multi-workspace) server which repo this snapshot is for, so it writes to
  // that workspace's DB regardless of which one the user currently has active.
  if (process.env.BEACON_REPO) headers["x-beacon-workspace"] = idForPath(process.env.BEACON_REPO);
  const res = await fetch(`${controlUrl}/api/ingest`, {
    method: "POST",
    headers,
    body: JSON.stringify(snapshot),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}
