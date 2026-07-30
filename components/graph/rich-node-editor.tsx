"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { EditorContent, ReactRenderer, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline as UnderlineIcon,
} from "lucide-react";
import { docToMarkdown, markdownToEditorDoc, nodeEditorBaseExtensions } from "@/lib/note-markdown";
import { MentionNode } from "@/lib/node-mention";
import type { MentionHit } from "@/lib/mention-search";
import type { LucideIcon } from "lucide-react";
import { ToolbarButton, useEditorTick } from "@/components/editor/editor-toolbar";
import { currentTabWs, wsHeaders } from "@/lib/tab-ws";
import { cn } from "@/lib/utils";

// Rich node-description editor: the app's Tiptap stack (markdown shortcuts as you type — `- `,
// `**bold**`, `# `, `[ ] `) plus a unified @-mention picker over every Beacon entity. Loads from
// the stored markdown and reports changes back as markdown (one serialization path, shared with
// notes), so a description still persists as `Node.plain`. Used inline in the node card (compact)
// and roomy in the detail side panel.
export function RichNodeEditor({
  value,
  onChange,
  onBlur,
  onFocus,
  autoFocus,
  compact,
  bare,
  roomy,
  className,
  placeholder = "Description (markdown)… type @ to mention a file, feature, table…",
  editable = true,
}: {
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  autoFocus?: boolean;
  compact?: boolean;
  /** Drop the inset surface (background + padding) and size the text up — used by the focus modal,
      which already provides its own roomy writing surface. */
  bare?: boolean;
  /** Long-form reading scale for the card-detail modal: Linear's issue body — 15px at full
      contrast on a ~72ch measure, real heading hierarchy, and NO inset box in either state, so
      clicking into it to edit doesn't reflow the prose. The canvas card keeps the compact scale. */
  roomy?: boolean;
  className?: string;
  placeholder?: string;
  // When false (read-only boards: shared view, archived plan history, the expanded card's
  // description) the editor renders its content but can't be typed into.
  editable?: boolean;
}) {
  const editor = useEditor({
    editable,
    extensions: [
      ...nodeEditorBaseExtensions,
      Placeholder.configure({
        // Only on the line the caret is on, so a long description isn't littered with hints.
        showOnlyCurrent: true,
        placeholder: ({ editor: ed }) => (ed.isEmpty ? placeholder : "Type / for commands…"),
      }),
      SlashCommands,
      MentionNode.configure({ suggestion: mentionSuggestion() as never }),
    ],
    content: value ? (markdownToEditorDoc(value) as object) : undefined,
    immediatelyRender: false, // required under Next SSR
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        // nodrag/nopan: typing + selecting must not pan/drag the React Flow canvas.
        class: cn("nodrag nopan node-prose focus:outline-none", className),
      },
    },
    onUpdate: ({ editor }) => onChange(docToMarkdown(editor.getJSON())),
    onBlur: () => onBlur?.(),
    onFocus: () => onFocus?.(),
  });

  // Keep the editor's editable flag in sync if it ever flips after mount.
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // Keep external value changes (e.g. an agent's update arriving via live-refresh) in sync when
  // the editor isn't focused, without clobbering what the user is typing.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = docToMarkdown(editor.getJSON());
    if (current !== value) editor.commands.setContent(value ? (markdownToEditorDoc(value) as object) : "");
  }, [editor, value]);

  if (!editor) return null;
  return (
    <div className="flex flex-col">
      {/* Linear's model, and the reason the docked bar is gone: blocks come from `/`, inline
          formatting comes from a bubble over the selection. There is no persistent toolbar to
          pin, so the whole class of sticky/ghosting bugs it caused simply does not exist. */}
      {editable && (
        <BubbleMenu
          editor={editor}
          appendTo={() => document.body}
          options={{ strategy: "fixed", placement: "top", offset: 8 }}
          className="glass nodrag nopan z-[100] flex items-center gap-0.5 rounded-lg p-1 shadow-xl"
        >
          <Toolbar editor={editor} compact={compact} />
        </BubbleMenu>
      )}
      <EditorContent
        editor={editor}
        // Stop keystrokes bubbling to the canvas (delete/space/etc. are canvas shortcuts).
        onKeyDown={(e) => e.stopPropagation()}
        className={cn(
          "node-editor rounded",
          // The inset writing surface only appears while the editor is EDITABLE — a read-only
          // render (detail sidebar view mode, shared boards) shows the rich text clean, no box.
          // `roomy` opts out of the box in BOTH states: the detail modal reads like a document,
          // and clicking into it to edit must not reflow the prose it just replaced.
          roomy
            ? "node-roomy min-h-[3.5rem] text-[15px] leading-[1.62] text-foreground"
            : bare
              ? "min-h-[3.5rem] text-[15px] leading-relaxed"
              : editable
                ? "min-h-[3.5rem] bg-[var(--ink-hover)] px-1.5 py-1 text-xs focus-within:bg-[var(--ink-active)]"
                : "text-xs",
          compact && "max-h-[24rem] overflow-y-auto",
        )}
      />
    </div>
  );
}

// Slim formatting toolbar — markdown shortcuts cover most typing, so this only surfaces the
// common toggles. Lives in the docked bar above.
function Toolbar({ editor, compact }: { editor: Editor; compact?: boolean }) {
  useEditorTick(editor); // keep isActive() highlights current
  const c = () => editor.chain().focus();
  const size = compact ? "size-3" : "size-3.5";
  return (
    <div className="flex items-center gap-0.5">
      <ToolbarButton label="Bold" active={editor.isActive("bold")} onClick={() => c().toggleBold().run()}>
        <Bold className={size} />
      </ToolbarButton>
      <ToolbarButton label="Italic" active={editor.isActive("italic")} onClick={() => c().toggleItalic().run()}>
        <Italic className={size} />
      </ToolbarButton>
      <ToolbarButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => c().toggleStrike().run()}>
        <Strikethrough className={size} />
      </ToolbarButton>
      <ToolbarButton label="Underline" active={editor.isActive("underline")} onClick={() => c().toggleUnderline().run()}>
        <UnderlineIcon className={size} />
      </ToolbarButton>
      <ToolbarButton label="Inline code" active={editor.isActive("code")} onClick={() => c().toggleCode().run()}>
        <Code className={size} />
      </ToolbarButton>
    </div>
  );
}

// ── `/` slash commands ─────────────────────────────────────────────────────────────────
// Blocks are inserted from here, not from a toolbar (Linear's model). Reuses the same
// Suggestion + ReactRenderer plumbing as @-mentions below, so there is one popup mechanism.
type SlashItem = { label: string; hint: string; Icon: LucideIcon; run: (e: Editor) => void };

const SLASH_ITEMS: SlashItem[] = [
  { label: "Heading 1", hint: "#", Icon: Heading1, run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: "Heading 2", hint: "##", Icon: Heading2, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: "Heading 3", hint: "###", Icon: Heading3, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: "Bulleted list", hint: "-", Icon: List, run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: "Numbered list", hint: "1.", Icon: ListOrdered, run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: "Checklist", hint: "[ ]", Icon: ListChecks, run: (e) => e.chain().focus().toggleTaskList().run() },
  { label: "Quote", hint: ">", Icon: Quote, run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: "Code block", hint: "```", Icon: Code, run: (e) => e.chain().focus().toggleCodeBlock().run() },
];

const SlashList = forwardRef<
  { onKeyDown: (p: { event: KeyboardEvent }) => boolean },
  { items: SlashItem[]; command: (item: SlashItem) => void }
>(function SlashList({ items, command }, ref) {
  const [sel, setSel] = useState(0);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setSel(0), [items]);
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowDown") {
        setSel((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSel((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const it = items[sel];
        if (it) command(it);
        return true;
      }
      return false;
    },
  }));
  if (!items.length) return null;
  return (
    <div className="glass max-h-72 w-60 overflow-y-auto rounded-lg p-1 shadow-xl" role="listbox">
      {items.map((it, i) => (
        <button
          key={it.label}
          type="button"
          role="option"
          aria-selected={i === sel}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command(it)}
          onMouseEnter={() => setSel(i)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
            i === sel ? "bg-[var(--ink-active)] text-foreground" : "text-muted-foreground",
          )}
        >
          <it.Icon className="size-3.5 shrink-0" />
          <span className="flex-1">{it.label}</span>
          <span className="font-mono text-[10px] text-muted-foreground/60">{it.hint}</span>
        </button>
      ))}
    </div>
  );
});

const SlashCommands = Extension.create({
  name: "slashCommands",
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        // Start-of-line only, so a "/" inside a file path never opens the menu.
        startOfLine: true,
        items: ({ query }: { query: string }) =>
          SLASH_ITEMS.filter((i) => i.label.toLowerCase().includes(query.toLowerCase())),
        command: ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: SlashItem }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
        },
        render: () => {
          let component: ReactRenderer<
            { onKeyDown: (p: { event: KeyboardEvent }) => boolean },
            { items: SlashItem[]; command: (item: SlashItem) => void }
          > | null = null;
          let popup: HTMLDivElement | null = null;
          const place = (rect: (() => DOMRect | null) | null | undefined) => {
            if (!popup || !rect) return;
            const r = rect();
            if (!r) return;
            popup.style.left = `${r.left}px`;
            popup.style.top = `${r.bottom + 4}px`;
          };
          return {
            onStart: (props: { editor: Editor; clientRect?: (() => DOMRect | null) | null }) => {
              component = new ReactRenderer(SlashList, { props, editor: props.editor });
              popup = document.createElement("div");
              popup.style.position = "fixed";
              popup.style.zIndex = "10000";
              document.body.appendChild(popup);
              popup.appendChild(component.element);
              place(props.clientRect);
            },
            onUpdate: (props: { clientRect?: (() => DOMRect | null) | null }) => {
              component?.updateProps(props);
              place(props.clientRect);
            },
            onKeyDown: (props: { event: KeyboardEvent }) => {
              if (props.event.key === "Escape") {
                popup?.remove();
                return true;
              }
              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              popup?.remove();
              popup = null;
              component?.destroy();
              component = null;
            },
          };
        },
      }),
    ];
  },
});

// ── @-mention suggestion ────────────────────────────────────────────────────────────────
const KIND_ICON: Record<string, string> = {
  file: "📄",
  folder: "📁",
  feature: "🧩",
  table: "⛁",
  endpoint: "⇄",
  note: "🗒",
};

type SuggestionProps = {
  items: MentionHit[];
  command: (hit: MentionHit) => void;
};

const MentionList = forwardRef<{ onKeyDown: (p: { event: KeyboardEvent }) => boolean }, SuggestionProps>(
  function MentionList({ items, command }, ref) {
    const [sel, setSel] = useState(0);
    // Reset the highlighted row when the result set changes (a new query). Syncing derived
    // selection to incoming props is exactly what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => setSel(0), [items]);
    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowDown") {
          setSel((s) => (s + 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "ArrowUp") {
          setSel((s) => (s - 1 + items.length) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "Enter") {
          if (items[sel]) command(items[sel]);
          return true;
        }
        return false;
      },
    }));
    if (!items.length) {
      return (
        <div className="glass min-w-56 rounded-lg p-2 text-[11px] text-muted-foreground shadow-xl">
          No matches
        </div>
      );
    }
    return (
      <div className="glass max-h-72 min-w-56 max-w-80 overflow-y-auto rounded-lg p-1 shadow-xl">
        {items.map((hit, i) => (
          <button
            key={`${hit.kind}:${hit.ref}`}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              command(hit);
            }}
            onMouseEnter={() => setSel(i)}
            className={cn(
              "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px]",
              i === sel ? "bg-[var(--ink-active)] text-foreground" : "text-foreground/85 hover:bg-[var(--ink-hover)]",
            )}
          >
            <span aria-hidden className="shrink-0 text-[11px] opacity-80">
              {KIND_ICON[hit.kind] ?? "•"}
            </span>
            <span className="truncate">{hit.label}</span>
            {hit.sublabel && (
              <span className="ml-auto shrink-0 truncate text-[10px] text-muted-foreground/70">
                {hit.sublabel}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  },
);

// Suggestion config for the Mention extension: fetch the unified picker, render a positioned React
// popup (no tippy), insert the chosen entity as a mention chip.
function mentionSuggestion() {
  return {
    char: "@",
    items: async ({ query }: { query: string }): Promise<MentionHit[]> => {
      if (!query.trim()) return [];
      try {
        const res = await fetch(`/api/mention-search?q=${encodeURIComponent(query)}`, {
          headers: wsHeaders(currentTabWs()),
        });
        if (!res.ok) return [];
        return ((await res.json()) as { hits: MentionHit[] }).hits;
      } catch {
        return [];
      }
    },
    command: ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: MentionHit }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: "mention", attrs: { kind: props.kind, ref: props.ref, label: props.label } },
          { type: "text", text: " " },
        ])
        .run();
    },
    render: () => {
      let component: ReactRenderer<{ onKeyDown: (p: { event: KeyboardEvent }) => boolean }, SuggestionProps> | null = null;
      let popup: HTMLDivElement | null = null;
      const place = (rect: (() => DOMRect | null) | null | undefined) => {
        if (!popup || !rect) return;
        const r = rect();
        if (!r) return;
        popup.style.left = `${r.left}px`;
        popup.style.top = `${r.bottom + 4}px`;
      };
      return {
        onStart: (props: { editor: Editor; clientRect?: (() => DOMRect | null) | null }) => {
          component = new ReactRenderer(MentionList, { props, editor: props.editor });
          popup = document.createElement("div");
          popup.style.position = "fixed";
          popup.style.zIndex = "10000";
          document.body.appendChild(popup);
          popup.appendChild(component.element);
          place(props.clientRect);
        },
        onUpdate: (props: { clientRect?: (() => DOMRect | null) | null }) => {
          component?.updateProps(props);
          place(props.clientRect);
        },
        onKeyDown: (props: { event: KeyboardEvent }) => {
          if (props.event.key === "Escape") {
            popup?.remove();
            return true;
          }
          return component?.ref?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          popup?.remove();
          popup = null;
          component?.destroy();
          component = null;
        },
      };
    },
  };
}
