import { describe, expect, it } from "bun:test";
import { docToMarkdown, markdownToEditorDoc } from "@/lib/note-markdown";

// A doc exercising every format the toolbar offers: bold, italic, strikethrough,
// underline, bullet list, numbered list, and checked/unchecked task items.
const doc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", marks: [{ type: "bold" }], text: "Login" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", marks: [{ type: "italic" }], text: "soon" },
        { type: "text", text: " / " },
        { type: "text", marks: [{ type: "strike" }], text: "risky" },
        { type: "text", text: " / " },
        { type: "text", marks: [{ type: "underline" }], text: "important" },
      ],
    },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "alpha" }] }] },
      ],
    },
    {
      type: "orderedList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] },
      ],
    },
    {
      type: "taskList",
      content: [
        { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "todo" }] }] },
        { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }] },
      ],
    },
  ],
};

// deno-lint-ignore no-explicit-any
function textNodes(node: any, acc: any[] = []): any[] {
  if (node?.type === "text") acc.push(node);
  for (const c of node?.content ?? []) textNodes(c, acc);
  return acc;
}

describe("note markdown serialization", () => {
  it("serializes bold, italic and strikethrough to GFM", () => {
    const md = docToMarkdown(doc);
    expect(md).toContain("**Login**");
    expect(md).toContain("*soon*");
    expect(md).toContain("~~risky~~");
  });

  it("serializes underline as inline <u> (GFM has no underline mark)", () => {
    expect(docToMarkdown(doc)).toContain("<u>important</u>");
  });

  it("serializes bullet and numbered lists", () => {
    const md = docToMarkdown(doc);
    expect(md).toMatch(/^- alpha$/m);
    expect(md).toMatch(/^1\. first$/m);
  });

  it("serializes checkbox todos as GFM task items", () => {
    const md = docToMarkdown(doc);
    expect(md).toContain("- [ ] todo");
    expect(md).toContain("- [x] done");
  });

  it("restores the underline mark from <u> when loading markdown", () => {
    const loaded = markdownToEditorDoc("plain <u>important</u> tail");
    const underlined = textNodes(loaded).find((n) => n.text === "important");
    expect(underlined).toBeDefined();
    expect(underlined.marks?.some((m: { type: string }) => m.type === "underline")).toBe(true);
    // The literal angle brackets must be gone — they became a real mark.
    expect(JSON.stringify(loaded)).not.toContain("<u>");
  });

  it("round-trips underline and task state through markdown -> doc -> markdown", () => {
    const md = docToMarkdown(doc);
    const back = docToMarkdown(markdownToEditorDoc(md));
    expect(back).toContain("<u>important</u>");
    expect(back).toContain("- [ ] todo");
    expect(back).toContain("- [x] done");
  });
});
