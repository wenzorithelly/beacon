import { test, expect } from "bun:test";
import { docToMarkdown, markdownToEditorDoc } from "@/lib/note-markdown";

// Empty paragraphs (blank lines a user adds for spacing) must survive a save→reload round-trip.
// Markdown has no token for an empty paragraph, so they're preserved as a non-breaking space and
// stripped back to empty on load (lib/note-markdown).

const li = (t: string) => ({
  type: "listItem",
  content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
});
const para = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const empty = { type: "paragraph" };

function roundTrip(doc: unknown) {
  return markdownToEditorDoc(docToMarkdown(doc)) as {
    content: { type: string; content?: unknown[] }[];
  };
}

test("blank line between a list and a paragraph survives (the reported case)", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "orderedList", attrs: { start: 1 }, content: [li("x"), li("y"), li("z")] },
      empty,
      para("Need to answer:"),
    ],
  };
  const back = roundTrip(doc);
  expect(back.content.map((n) => n.type)).toEqual(["orderedList", "paragraph", "paragraph"]);
  // the middle node is a genuinely empty paragraph (the preserved blank line), not a nbsp run
  expect(back.content[1].content ?? []).toHaveLength(0);
});

test("blank line between two paragraphs survives", () => {
  const back = roundTrip({ type: "doc", content: [para("a"), empty, para("b")] });
  expect(back.content.map((n) => n.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
  expect(back.content[1].content ?? []).toHaveLength(0);
});
