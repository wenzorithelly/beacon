import { z } from "zod";
import { addSubtasksUnder } from "@/lib/map-ops";
import { runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";

// Bulk sub-task creation under a parent. Used by the `beacon_add_subtasks` MCP tool so
// a terminal session can attach N follow-ups to a feature in one call (instead of N
// position-fiddling /api/nodes POSTs). Parent resolves by id (preferred) or fuzzy title.

const bodySchema = z.object({
  parentId: z.string().trim().min(1).nullish(),
  parentTitle: z.string().trim().min(1).nullish(),
  items: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        plain: z.string().trim().max(2000).nullish(),
        // FEATURE (default) | BUG — parse-tolerant; normalized in addSubtasksUnder.
        kind: z.string().trim().max(16).nullish(),
        // frontend | backend | fullstack — parse-tolerant; defaults to the parent's layer.
        layer: z.string().trim().max(16).nullish(),
      }),
    )
    .min(1),
});

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (e) {
    return new Response(`Invalid body: ${e instanceof Error ? e.message : "error"}`, {
      status: 400,
    });
  }

  if (!parsed.parentId && !parsed.parentTitle) {
    return new Response("parentId or parentTitle is required", { status: 400 });
  }

  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    const r = await addSubtasksUnder({
      parentId: parsed.parentId ?? undefined,
      parentTitle: parsed.parentTitle ?? undefined,
      items: parsed.items,
    });

    if (r.ok) return Response.json({ ok: true, parent: r.parent, created: r.created });
    if (r.reason === "parent_not_found")
      return Response.json(
        { ok: false, reason: "parent_not_found", error: "No parent feature matched. Call beacon_map to get the parent's id and pass it as parentId." },
        { status: 404 },
      );
    if (r.reason === "ambiguous")
      return Response.json({ ok: false, reason: "ambiguous", candidates: r.candidates }, { status: 409 });
    if (r.reason === "duplicate")
      return Response.json({ ok: false, reason: "duplicate", error: r.message }, { status: 409 });
    return Response.json({ ok: false, reason: r.reason }, { status: 400 });
  });
}
