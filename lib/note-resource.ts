import { slug } from "@/lib/slug";

// Pure formatting for the note://{slug} @-mention resource. Kept free of
// fetch/db so it unit-tests directly; bin/mcp.ts wires the /api/notes fetch and
// passes the rows through these. No AI — the agent reads the note's markdown verbatim.

export interface NoteResourceRow {
  id: string;
  title: string;
  body: string;
  pinned?: boolean;
}

// Note titles aren't unique (they default to "Untitled"), so a short id segment
// disambiguates while keeping the URI readable.
export function noteSlug(note: { id: string; title: string }): string {
  return `${slug(note.title)}-${note.id.slice(-6)}`;
}

/** ListResources payload — one entry per note. */
export function noteResourceList(notes: NoteResourceRow[]) {
  return {
    resources: notes.map((n) => ({
      uri: `note://${noteSlug(n)}`,
      name: n.title || "Untitled",
      description: `${n.title || "Untitled"}${n.pinned ? " · pinned" : ""} · note`,
      mimeType: "text/markdown" as const,
    })),
  };
}

export function findNoteBySlug(
  notes: NoteResourceRow[],
  s: string,
): NoteResourceRow | undefined {
  return notes.find((n) => noteSlug(n) === s);
}

/** ReadResource payload — the note's markdown body VERBATIM under a title header,
 *  with a one-line deterministic instruction so the agent knows how to turn it into work. */
export function renderNoteResource(note: NoteResourceRow): string {
  const body = note.body.trim() || "(this note is empty)";
  return [
    `# ${note.title || "Untitled"}`,
    "",
    "_User note from Beacon. To turn it into roadmap work, call `beacon_propose_plan` —" +
      " checkbox `- [ ]` / `- [x]` items become subtasks, and order the features with" +
      " `dependsOn`. Do NOT implement until it returns approval._",
    "",
    "---",
    "",
    body,
  ].join("\n");
}
