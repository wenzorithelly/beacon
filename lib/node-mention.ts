import { Node, mergeAttributes } from "@tiptap/core";
import { Mention } from "@tiptap/extension-mention";

// The kinds the unified @-picker can reference. Stored on the mention node + encoded into the
// beacon:// link so a click can route to the right surface.
export type MentionKind = "file" | "folder" | "feature" | "table" | "endpoint" | "note";

export const MENTION_PREFIX = "beacon://";

/** Build the markdown link a mention serializes to: `[@label](beacon://kind/ref)`. */
export function mentionLink(kind: string, ref: string, label: string): string {
  return `[@${label}](${MENTION_PREFIX}${kind}/${ref})`;
}

/** Parse a `beacon://kind/ref` href into its parts, or null if it isn't a mention href. */
export function parseMentionHref(href: string): { kind: string; ref: string } | null {
  if (!href.startsWith(MENTION_PREFIX)) return null;
  const rest = href.slice(MENTION_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  return { kind: rest.slice(0, slash), ref: rest.slice(slash + 1) };
}

// Shared attr spec — both nodes below carry kind / ref / label, so the JSON the serializer
// produces and the JSON the live editor edits are interchangeable.
const mentionAttributes = {
  kind: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-kind"),
    renderHTML: (attrs: { kind?: string | null }) => (attrs.kind ? { "data-kind": attrs.kind } : {}),
  },
  ref: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-ref"),
    renderHTML: (attrs: { ref?: string | null }) => (attrs.ref ? { "data-ref": attrs.ref } : {}),
  },
  label: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-label") ?? el.textContent?.replace(/^@/, ""),
    renderHTML: (attrs: { label?: string | null }) => (attrs.label ? { "data-label": attrs.label } : {}),
  },
};

// Shared DOM (de)serialization for the chip — both nodes render an identical `@label` pill, so
// the schema/HTML stays in one place.
const mentionParseHTML = () => [{ tag: "span[data-mention]" }];
const mentionRenderHTML = ({
  node,
  HTMLAttributes,
}: {
  node: { attrs: { label?: string | null } };
  HTMLAttributes: Record<string, unknown>;
}) =>
  [
    "span",
    mergeAttributes({ "data-mention": "", class: "beacon-mention" }, HTMLAttributes),
    `@${node.attrs.label ?? ""}`,
  ] as const;

// ── Serializer node (headless) ──────────────────────────────────────────────────────────
// A MINIMAL inline-atom node for @tiptap/markdown's MarkdownManager only. renderMarkdown (keyed
// by node type) turns it into a beacon:// link; we deliberately register NO markdownName and
// nothing from @tiptap/extension-mention here — both register an `@` tokenizer that hijacks the
// link text on parse. Parsing is handled by restoreMentions in lib/note-markdown (the node-side
// twin, mirroring MarkdownUnderline + restoreUnderline).
export const MentionMarkdownNode = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => mentionAttributes,
  parseHTML: mentionParseHTML,
  renderHTML: mentionRenderHTML,
  renderMarkdown: (node) => {
    const a = (node as { attrs?: { kind?: string; ref?: string; label?: string } }).attrs ?? {};
    return mentionLink(a.kind ?? "feature", a.ref ?? "", a.label ?? "");
  },
});

// ── Live-editor node ────────────────────────────────────────────────────────────────────
// The full mention for the Tiptap editor: same name + attrs as the serializer node (so JSON is
// interchangeable), but built on @tiptap/extension-mention for the `@` suggestion popup. The
// suggestion (items/render) is configured at the use-site via .configure({ suggestion }). The
// editor never serializes through this — docToMarkdown uses the serializer node above.
export const MentionNode = Mention.extend({
  name: "mention",
  addAttributes: () => mentionAttributes,
  parseHTML: mentionParseHTML,
  renderHTML: mentionRenderHTML,
});
