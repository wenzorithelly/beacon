import { z } from "zod";
import { pinned } from "@/lib/api-workspace";
import { buildBoardsSnapshot } from "@/lib/share-builder";
import { buildPendingPlanSnapshot, buildArchivedPlanSnapshot } from "@/lib/plan-share";
import { BOARD_TABS, type ShareSnapshot } from "@/lib/share-snapshot";
import { SITE_URL } from "@/lib/release";

// LOCAL daemon route the Share affordances call. Workspace-pinned: it serializes what the user is
// viewing (a board selection, or one plan) and relays the snapshot to the deploy's public
// /api/share (the local install can't store it). Returns the public link to copy. NEVER served on
// the deploy (proxy.ts only allows the exact /api/share), so it can't be abused there.
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("kind", [
  // "boards": share the live boards — All resolves to all three tabs client-side. `pinned` + `token`
  // publish the fixed, never-expiring prod board (gated by SHARE_ADMIN_TOKEN, forwarded below).
  z.object({
    kind: z.literal("boards"),
    tabs: z.array(z.enum(BOARD_TABS)).min(1),
    pinned: z.boolean().optional(),
    token: z.string().min(1).optional(),
  }),
  // "plan": share ONE plan — the open/pending one (no planId) or a past archived one (planId).
  z.object({ kind: z.literal("plan"), planId: z.string().optional() }),
]);

export const POST = pinned(async (req: Request) => {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid share request." }, { status: 400 });
  }

  let snapshot: ShareSnapshot | null;
  try {
    snapshot =
      body.kind === "boards"
        ? await buildBoardsSnapshot(body.tabs)
        : body.planId
          ? await buildArchivedPlanSnapshot(body.planId)
          : await buildPendingPlanSnapshot();
  } catch {
    return Response.json({ error: "Could not build the snapshot." }, { status: 500 });
  }
  if (!snapshot) {
    return Response.json(
      { error: body.kind === "plan" ? "There's no plan to share." : "Nothing to share." },
      { status: 400 },
    );
  }

  // Pinned (prod-board) publish: forward the admin secret + the fixed token so the deploy upserts a
  // permanent, never-expiring row. The secret comes from the request (the publish script) or the
  // daemon env — local-only route, so either source is fine. Without it we can't authorize, so 400.
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (body.kind === "boards" && body.pinned) {
    const secret = req.headers.get("x-beacon-admin-token") ?? process.env.SHARE_ADMIN_TOKEN;
    if (!secret) {
      return Response.json(
        { error: "Set SHARE_ADMIN_TOKEN (env or x-beacon-admin-token header) to publish a pinned board." },
        { status: 400 },
      );
    }
    if (!body.token) {
      return Response.json({ error: "A pinned board needs a fixed token." }, { status: 400 });
    }
    headers["authorization"] = `Bearer ${secret}`;
    headers["x-beacon-share-token"] = body.token;
  }

  try {
    const res = await fetch(`${SITE_URL}/api/share`, {
      method: "POST",
      headers,
      body: JSON.stringify(snapshot),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = res.status === 413 ? "This is too large to share." : `Share service error (${res.status}).`;
      return Response.json({ error: detail }, { status: 502 });
    }
    const data = (await res.json()) as { token: string; url: string };
    return Response.json({ url: data.url, token: data.token });
  } catch {
    return Response.json({ error: "Could not reach the share service." }, { status: 502 });
  }
});
