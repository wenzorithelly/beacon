import { StarterKit } from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Underline } from "@tiptap/extension-underline";
import { MarkdownManager } from "@tiptap/markdown";
import { MentionMarkdownNode, parseMentionHref } from "@/lib/node-mention";

// Underline has no Markdown equivalent, so it serializes to inline <u> HTML — GFM keeps raw
// HTML, so the agent sees the emphasis verbatim. `marked` splits a paired tag into three
// tokens (<u> / text / </u>), so the default parser can't read it back; markdownToEditorDoc
// restores it deterministically on load (see restoreUnderline). renderMarkdown is the
// documented hook for custom mark serialization.
const MarkdownUnderline = Underline.extend({
  renderMarkdown: (node, helpers) => `<u>${helpers.renderChildren(node)}</u>`,
});

// Content schema shared by the live editor AND the headless markdown engine, so what the
// editor saves and what the tests assert come from ONE definition. StarterKit v3 already
// bundles Bold/Italic/Strike/Underline/lists/headings; we disable its Underline to swap in
// the <u>-serializing one, and add task lists for the clickable checkboxes.
// Shared base — everything EXCEPT a mention node. The node editor appends the full MentionNode
// (with the @ suggestion popup); the manager + notes editor append the markdown serializer node.
// Two nodes named "mention" can't coexist in one schema, so the mention node is added per-surface.
const baseExtensions = [
  // `underline: false` removes StarterKit's bundled underline so MarkdownUnderline owns it.
  StarterKit.configure({ underline: false } as never),
  MarkdownUnderline,
  TaskList,
  TaskItem.configure({ nested: true }),
];

const contentExtensions = [
  ...baseExtensions,
  // The serializer mention node — its renderMarkdown turns a chip into a `beacon://` link; parsing
  // is handled by restoreMentions below. The live node editor uses MentionNode (with the suggestion
  // popup) instead, but both share the same name + attrs so the JSON is interchangeable.
  MentionMarkdownNode,
];

/** Extensions for the live notes editor. Works in ProseMirror JSON: loads from
 *  markdownToEditorDoc() and saves via docToMarkdown(editor.getJSON()), so the markdown engine
 *  below is the single serialization path. Includes the (suggestion-less) mention node so a
 *  beacon:// mention renders as a chip if one appears. */
export const noteEditorExtensions = contentExtensions;

/** Mention-less base for the NODE editor, which appends the full MentionNode (with the @ picker)
 *  itself — see components/graph/rich-node-editor.tsx. */
export const nodeEditorBaseExtensions = baseExtensions;

// One markdown engine, built from the same content extensions the editor uses, so what the
// editor renders and what we store stay in lockstep. No DOM needed.
const manager = new MarkdownManager({ extensions: contentExtensions as never });

/** Tiptap JSON doc → GFM markdown (the bytes stored in Note.body, read by the agent). */
export function docToMarkdown(doc: unknown): string {
  return manager.serialize(doc as never);
}

type JsonNode = {
  type?: string;
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
};

// Split a text node on <u>…</u>, applying the underline mark to the inner runs. Keeps any
// marks the node already had (so underline composes with bold/italic on the same run).
function splitUnderline(node: JsonNode): JsonNode[] {
  const text = node.text ?? "";
  const base = node.marks ?? [];
  const re = /<u>([\s\S]*?)<\/u>/g;
  const out: JsonNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ ...node, text: text.slice(last, m.index) });
    out.push({ type: "text", text: m[1], marks: [...base, { type: "underline" }] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ ...node, text: text.slice(last) });
  return out.filter((n) => (n.text ?? "").length > 0);
}

// Recursively restore underline marks from literal <u>…</u> left in text nodes by the parser.
function restoreUnderline(node: JsonNode): JsonNode {
  if (node.type === "text" && (node.text ?? "").includes("<u>")) {
    // A lone text node is replaced by its split runs; the parent re-flattens (below).
    return { type: "__frag", content: splitUnderline(node) };
  }
  if (Array.isArray(node.content)) {
    const content = node.content.flatMap((c) => {
      const r = restoreUnderline(c);
      return r.type === "__frag" ? r.content! : [r];
    });
    return { ...node, content };
  }
  return node;
}

// A `[@label](beacon://kind/ref)` mention serializes through marked as a text node carrying a
// `link` mark whose href starts with beacon:// (StarterKit bundles Link). Convert those back into
// mention nodes — the node-side twin of renderMarkdown in lib/node-mention. Mirrors restoreUnderline.
function restoreMentions(node: JsonNode): JsonNode {
  if (node.type === "text") {
    const link = (node.marks ?? []).find(
      (m): m is { type: string; attrs?: { href?: string } } =>
        m.type === "link" && typeof (m as { attrs?: { href?: string } }).attrs?.href === "string",
    );
    const parsed = link?.attrs?.href ? parseMentionHref(link.attrs.href) : null;
    if (parsed) {
      return {
        type: "mention",
        attrs: { kind: parsed.kind, ref: parsed.ref, label: (node.text ?? "").replace(/^@/, "") },
      };
    }
  }
  if (Array.isArray(node.content)) {
    return { ...node, content: node.content.map(restoreMentions) };
  }
  return node;
}

/** GFM markdown → Tiptap JSON doc for loading into the editor. Runs the default parser
 *  (tasks, bold/italic/strike, lists all round-trip) then restores underline marks + mentions. */
export function markdownToEditorDoc(markdown: string): unknown {
  return restoreMentions(restoreUnderline(manager.parse(markdown) as JsonNode));
}
