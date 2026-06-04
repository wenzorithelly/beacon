import type { Snapshot } from "@/lib/ingest";

export async function postSnapshot(controlUrl: string, snapshot: Snapshot) {
  const res = await fetch(`${controlUrl}/api/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(snapshot),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}
