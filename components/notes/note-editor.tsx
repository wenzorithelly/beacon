"use client";

import { useEffect, useReducer } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import {
  Bold,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Strikethrough,
  Underline as UnderlineIcon,
} from "lucide-react";
import { docToMarkdown, markdownToEditorDoc, noteEditorExtensions } from "@/lib/note-markdown";
import { cn } from "@/lib/utils";

// WYSIWYG note editor. Works in ProseMirror JSON: loads from the stored markdown via
// markdownToEditorDoc(), and reports changes back as markdown via docToMarkdown() — the
// single serialization path that the headless tests pin (incl. underline -> <u> and
// checkbox todos -> `- [ ]`/`- [x]`). The parent remounts this per note (key=note.id),
// so initial content is set once and React owns nothing about the doc afterwards.
export function NoteEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (markdown: string) => void;
}) {
  const editor = useEditor({
    extensions: noteEditorExtensions,
    content: value ? (markdownToEditorDoc(value) as object) : undefined,
    immediatelyRender: false, // required under Next SSR to avoid a hydration mismatch
    editorProps: {
      attributes: { class: "note-prose focus:outline-none" },
    },
    onUpdate: ({ editor }) => onChange(docToMarkdown(editor.getJSON())),
  });

  if (!editor) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar editor={editor} />
      <EditorContent
        editor={editor}
        className="min-h-0 flex-1 overflow-y-auto px-1 py-2 text-[14px] leading-relaxed"
      />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  // Re-render the toolbar on every transaction so isActive() highlights stay current.
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const update = () => force();
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  const c = () => editor.chain().focus();
  return (
    <div className="flex items-center gap-0.5 border-b border-white/10 pb-2">
      <TBtn label="Bold" active={editor.isActive("bold")} onClick={() => c().toggleBold().run()}>
        <Bold className="size-4" />
      </TBtn>
      <TBtn label="Italic" active={editor.isActive("italic")} onClick={() => c().toggleItalic().run()}>
        <Italic className="size-4" />
      </TBtn>
      <TBtn
        label="Underline"
        active={editor.isActive("underline")}
        onClick={() => c().toggleUnderline().run()}
      >
        <UnderlineIcon className="size-4" />
      </TBtn>
      <TBtn label="Strikethrough" active={editor.isActive("strike")} onClick={() => c().toggleStrike().run()}>
        <Strikethrough className="size-4" />
      </TBtn>
      <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />
      <TBtn label="Checklist" active={editor.isActive("taskList")} onClick={() => c().toggleTaskList().run()}>
        <ListChecks className="size-4" />
      </TBtn>
      <TBtn label="Bullet list" active={editor.isActive("bulletList")} onClick={() => c().toggleBulletList().run()}>
        <List className="size-4" />
      </TBtn>
      <TBtn
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => c().toggleOrderedList().run()}
      >
        <ListOrdered className="size-4" />
      </TBtn>
    </div>
  );
}

function TBtn({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      // preventDefault keeps the editor selection while clicking the button.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground",
        active && "bg-white/[0.12] text-foreground",
      )}
    >
      {children}
    </button>
  );
}
