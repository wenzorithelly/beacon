import { pinned } from "@/lib/api-workspace";
import {
  SavedViewError,
  createSavedView,
  deleteSavedView,
  isSavedViewBoard,
  listSavedViews,
  updateSavedView,
  type SavedViewCreate,
  type SavedViewPatch,
} from "@/lib/saved-views";

export const dynamic = "force-dynamic";

// Named board views (filters + arrange + hide-empty + folds + group-by). File-backed, no DB
// table — see lib/saved-views. Pinned so a view saved in the tab the user is LOOKING at lands
// in that workspace, not whatever a background agent last made active.
//
//   GET    /api/saved-views[?board=roadmap]   → SavedView[]
//   POST   { board, name, state }             → 201 SavedView
//   PATCH  { id, name?, state?, isDefault? }  → 200 SavedView   (isDefault:false clears default)
//   DELETE ?id=…                              → 204

// A body that isn't a JSON object is a client bug, not a 500.
async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw new SavedViewError("body must be JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SavedViewError("body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

// Validation/duplicate/cap problems carry their own status; anything else is a real bug and
// must keep bubbling to the framework's 500 rather than being swallowed as a 400.
function fail(e: unknown): Response {
  if (e instanceof SavedViewError) return new Response(e.message, { status: e.status });
  throw e;
}

export const GET = pinned(async (req: Request) => {
  const board = new URL(req.url).searchParams.get("board");
  if (board !== null && !isSavedViewBoard(board)) {
    return new Response("unknown board", { status: 400 });
  }
  return Response.json(listSavedViews(board ?? undefined));
});

export const POST = pinned(async (req: Request) => {
  try {
    const created = createSavedView((await jsonBody(req)) as SavedViewCreate);
    return Response.json(created, { status: 201 });
  } catch (e) {
    return fail(e);
  }
});

export const PATCH = pinned(async (req: Request) => {
  try {
    const { id, ...patch } = await jsonBody(req);
    if (typeof id !== "string" || !id) return new Response("id is required", { status: 400 });
    const updated = updateSavedView(id, patch as SavedViewPatch);
    return updated ? Response.json(updated) : new Response("no such view", { status: 404 });
  } catch (e) {
    return fail(e);
  }
});

export const DELETE = pinned(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return new Response("id is required", { status: 400 });
  if (!deleteSavedView(id)) return new Response("no such view", { status: 404 });
  return new Response(null, { status: 204 });
});
