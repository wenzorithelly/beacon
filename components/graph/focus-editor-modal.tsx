"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { RichNodeEditor } from "@/components/graph/rich-node-editor";
import { GlassPanel } from "@/components/ui/glass-panel";

// Distraction-free description editor — a Notion-style "center peek": the card's description
// blows up into a centered modal over a blurred, dimmed board so you can write at full size.
// Autosaves on close (Esc / ⌘↵ / Save / backdrop all commit the draft — no data loss). The
// board stays untouched behind the blur; closing returns you exactly where you were.

export interface FocusEditPayload {
  id: string;
  title: string;
  value: string;
  editable: boolean;
  /** Persist the edited markdown (called on every close path — autosave semantics). */
  onCommit: (value: string) => void;
}

export function FocusEditorModal({
  payload,
  onDismiss,
}: {
  payload: FocusEditPayload | null;
  onDismiss: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Seed the draft synchronously when a new node opens (React's "adjust state during render"
  // pattern — no flash of empty content before an effect runs); reset to empty when it closes.
  if ((payload?.id ?? null) !== seededFor) {
    setSeededFor(payload?.id ?? null);
    setDraft(payload?.value ?? "");
  }

  // Esc / ⌘↵ close — on a CAPTURE-phase document listener so it fires BEFORE the Tiptap editor's
  // onKeyDown stopPropagation (which otherwise swallows Esc while the cursor is in the editor).
  useEffect(() => {
    if (!payload) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === "Enter")) {
        e.preventDefault();
        payload.onCommit(draft);
        onDismiss();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [payload, draft, onDismiss]);

  if (!payload) return null;

  const commit = () => {
    payload.onCommit(draft);
    onDismiss();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit description — ${payload.title}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) commit();
      }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-[5px] animate-in fade-in duration-150"
    >
      <GlassPanel
        className="flex max-h-[82vh] w-[min(720px,92vw)] flex-col rounded-2xl duration-150 animate-in fade-in zoom-in-95"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Description
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{payload.title}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {draft.length} chars
          </span>
          <button
            type="button"
            onClick={commit}
            title="Close (Esc)"
            className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-[40vh] flex-1 overflow-y-auto px-6 py-5 text-[15px] leading-relaxed">
          <RichNodeEditor
            bare
            autoFocus={payload.editable}
            editable={payload.editable}
            value={draft}
            onChange={setDraft}
          />
        </div>

        <div className="flex items-center gap-3 border-t border-white/10 px-4 py-2.5 text-[11.5px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-400" /> Autosaves
          </span>
          <span className="opacity-70">· Esc to close</span>
          {payload.editable && (
            <button
              type="button"
              onClick={commit}
              className="ml-auto flex items-center gap-1.5 rounded-lg bg-[#ff7a45] px-3 py-1.5 text-xs font-semibold text-black transition hover:brightness-110"
            >
              <Check className="size-3.5" /> Save &amp; close
            </button>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}
