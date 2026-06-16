import { describe, expect, it } from "bun:test";
import { docToMarkdown, markdownToEditorDoc } from "@/lib/note-markdown";

type J = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: J[] };

const para = (...content: J[]): J => ({ type: "doc", content: [{ type: "paragraph", content }] });

function findMention(doc: J): J | undefined {
  if (doc.type === "mention") return doc;
  for (const c of doc.content ?? []) {
    const f = findMention(c);
    if (f) return f;
  }
  return undefined;
}

// Mentions live INSIDE Node.plain markdown (no schema change). They serialize to an
// agent-readable beacon:// link and must round-trip back into a mention node.
describe("mention markdown round-trip", () => {
  it("serializes a mention node to a beacon:// link", () => {
    const md = docToMarkdown(
      para(
        { type: "text", text: "see " },
        { type: "mention", attrs: { kind: "feature", ref: "abc123", label: "Plan review loop" } },
      ),
    );
    expect(md).toContain("[@Plan review loop](beacon://feature/abc123)");
  });

  it("restores a mention node from a beacon:// link on load", () => {
    const doc = markdownToEditorDoc("see [@Plan review loop](beacon://feature/abc123)") as J;
    const m = findMention(doc);
    expect(m).toBeDefined();
    expect(m!.attrs).toMatchObject({ kind: "feature", ref: "abc123", label: "Plan review loop" });
  });

  it("round-trips a file mention whose ref contains slashes", () => {
    const md = docToMarkdown(
      para({
        type: "mention",
        attrs: { kind: "file", ref: "app/api/plan/route.ts", label: "app/api/plan/route.ts" },
      }),
    );
    const m = findMention(markdownToEditorDoc(md) as J);
    expect(m!.attrs).toMatchObject({ kind: "file", ref: "app/api/plan/route.ts" });
  });

  it("leaves ordinary markdown links untouched", () => {
    const doc = markdownToEditorDoc("see [docs](https://example.com)") as J;
    expect(findMention(doc)).toBeUndefined();
  });
});
