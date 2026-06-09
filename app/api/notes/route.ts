import { createNote, listNotes } from "@/lib/notes";
import { pinned } from "@/lib/api-workspace";

export const dynamic = "force-dynamic";

// List notes (pinned first, then most-recently-updated). Pinned so the MCP resource
// list (x-beacon-workspace header) and the browser drawer (beacon_ws cookie) each read
// their own workspace, not the global active one.
export const GET = pinned(async () => Response.json(await listNotes()));

// Create an empty note for the drawer's "new note" action; returns the new row.
export const POST = pinned(async () => Response.json(await createNote()));
