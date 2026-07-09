import { runWithWorkspace } from "@/lib/db-drizzle";
import { isDelivererLive, recordDelivererPresence } from "@/lib/deliverer-registry";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// Generic "a client can deliver input for this workspace" heartbeat (lib/deliverer-registry). ANY
// client may POST here to declare itself live — the daemon has zero awareness of what it is (a
// desktop shell, a browser extension, whatever). POST — heartbeat/register. GET — the browser
// (components/ask/ask-modal.tsx) checks this before rendering an ask's options as clickable.

export async function POST(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    recordDelivererPresence(Date.now());
    return Response.json({ ok: true });
  });
}

export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    return Response.json({ live: isDelivererLive(Date.now()) });
  });
}
