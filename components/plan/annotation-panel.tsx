"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, MessageSquarePlus, Trash2, Send, Strikethrough, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { clampToViewport } from "@/lib/popover-position";
import { currentPlanWs, wsHeaders } from "@/components/plan/use-plan-ws";
import type { TextAnnotation } from "@/lib/annotations";
import {
  splitBlocks,
  CodeBlock,
  TableBlock,
  Inline,
  renderBlockShell,
  isHeading,
  planHeadingAnchor,
  type Block,
} from "@/components/plan/markdown-view";

// The CSS Custom Highlight API paints an arbitrary Range independent of focus/selection, so the
// selected text stays highlighted while the comment composer (a focused textarea) is open — even
// when the selection spans inline markdown (`code`, **bold**), which the excerpt-string matcher
// can't re-locate in the raw markdown. We feature-detect once; older browsers fall back to the
// `__pending` pseudo-annotation injected into the renderer below.
const HIGHLIGHT_API =
  typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
const PENDING_HL = "beacon-pending"; // the selection being commented on right now (composer open)
const ANNOT_HL = "beacon-annotation"; // every saved comment's excerpt, re-located in the rendered DOM
const DEL_HL = "beacon-deletion"; // every deletion mark's excerpt (struck through via the same API)

// The HighlightRegistry / Highlight constructor aren't in this TS lib yet — access them through
// narrow casts behind the HIGHLIGHT_API feature check.
function highlightRegistry(): Map<string, unknown> | null {
  if (!HIGHLIGHT_API) return null;
  return (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
}
function makeHighlight(...ranges: Range[]): unknown {
  const Ctor = (globalThis as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
  return new Ctor(...ranges);
}

// Find the first rendered occurrence of `query` (the excerpt's plain text) inside `root`, spanning
// text nodes as needed, and return a Range for it. Searching the RENDERED text — not the raw
// markdown — is what lets a comment on text containing inline `code`/**bold** still highlight: the
// markers aren't in the DOM, so the plain excerpt matches. Skips FENCED code (<pre>) + tables, which
// aren't annotated; INLINE `code` (a bare <code>, no <pre>) stays searchable — it's part of prose.
function findFirstTextRange(root: HTMLElement, query: string): Range | null {
  if (!query) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      (n.parentElement?.closest("pre, table") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: { node: Node; start: number }[] = [];
  let full = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n, start: full.length });
    full += n.nodeValue ?? "";
  }
  const idx = full.indexOf(query);
  if (idx < 0) return null;
  const locate = (pos: number) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].start <= pos) return { node: nodes[i].node, offset: pos - nodes[i].start };
    }
    return null;
  };
  const s = locate(idx);
  const e = locate(idx + query.length);
  if (!s || !e) return null;
  const range = document.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  return range;
}

// Anchor point (viewport coords) for the floating popover/composer: the END of the selection —
// the bottom-right of its LAST client rect, i.e. where the user finished dragging. Anchoring at
// the end, not the bounding box's top-right corner, keeps the popover near the cursor instead of
// flying to the top-right of a tall multi-line selection (and over the top toolbar). Viewport
// coords because both consumers render position:fixed. Falls back to the bounding box.
function selectionAnchor(range: Range): { x: number; y: number } {
  const rects = range.getClientRects();
  const r = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
  return { x: r.right, y: r.bottom };
}

// A position:fixed style at (x,y), pulled fully on-screen. Only called from client-only render
// branches (popover/composer are null during SSR), so `window` is always defined here.
function clampedFixed(x: number, y: number, w: number, h: number) {
  const { left, top } = clampToViewport(x, y, w, h, window.innerWidth, window.innerHeight);
  return { position: "fixed" as const, left, top, zIndex: 60 };
}

// Native, inline annotation panel. Select text → small floating popover with two icons:
//   💬 = comment (text bubble anchored above the highlighted span)
//   🚫 = mark for deletion (strikethrough on the span; no comment needed)
// You can also just start typing immediately after selecting — Beacon auto-creates the
// comment with your first keystroke. A "Overall feedback" textarea at the top covers
// plan-level notes. Submit packages everything for the blocking MCP tool to return.

interface PopoverState {
  x: number;
  y: number;
  excerpt: string;
}

export interface AnnotationApi {
  liveCount: number;
  submitting: boolean;
  submitted: boolean;
  submit: () => void;
  // Drop ALL unsubmitted feedback (text annotations + overall comment) and clear the server
  // store, so the parent's "Clear to approve" can unblock Approve in one click.
  clearAll: () => void;
  // Surface annotation/global state so a parent (Plan pill) can render compact icon
  // buttons next to the verdict controls.
  annotationCount: number;
  hasGlobalComment: boolean;
  globalOpen: boolean;
  toggleOverall: () => void;
  // Full annotation list + handlers so the parent can render them inside the
  // canvas DetailSidebar's Comments tab.
  annotations: TextAnnotation[];
  updateComment: (id: string, comment: string) => void;
  removeAnnotation: (id: string) => void;
  focusOnAnnotation: (id: string) => void;
  // Add a fresh comment anchored to a canvas node/table (excerpt = its name) and focus it, so a
  // reviewer can comment on a feature card / DB table the same way they comment on markdown text.
  addComment: (excerpt: string) => void;
}

export function AnnotationPanel({
  markdown,
  round,
  onApi,
  hideSubmit = false,
  getExtraSubmitPayload,
}: {
  markdown: string;
  /** The plan's proposedAt — bumps on every (re)present. Re-syncs annotation state per round
      even when the prose is unchanged (e.g. a schema-only revision). */
  round?: number;
  /** Lifts the submit handler + counts up so a parent (Plan pill) can render the
      verdict button next to Approve/Discard. */
  onApi?: (api: AnnotationApi) => void;
  /** Hides the panel's own Submit button when the parent renders one. */
  hideSubmit?: boolean;
  /** Lets the parent fold extra fields (e.g. the current /db draft doc) into the
      submit POST body so canvas edits flow through the same feedback round-trip. */
  getExtraSubmitPayload?: () => Record<string, unknown>;
}) {
  const [annotations, setAnnotations] = useState<TextAnnotation[]>([]);
  const [globalComment, setGlobalComment] = useState("");
  const [globalOpen, setGlobalOpen] = useState(false);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  // The inline comment composer: a small textarea anchored at the selection. Opened by the
  // popover's comment button OR by typing after a selection; on confirm the comment is saved
  // and surfaces in the side-panel Comments list. `seed` is the keystroke that opened it.
  const [composer, setComposer] = useState<(PopoverState & { seed: string }) | null>(null);
  const [focusOnId, setFocusOnId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const docRef = useRef<HTMLDivElement | null>(null);
  const globalPopoverRef = useRef<HTMLDivElement | null>(null);
  // The selection Range captured when the composer opens — painted via the CSS Custom Highlight
  // API so the selected text stays highlighted while you type (the native selection is cleared
  // when the textarea takes focus).
  const pendingRangeRef = useRef<Range | null>(null);

  // Hydrate from server — and RE-hydrate whenever the plan's prose changes, i.e. the agent
  // re-presented a revised plan. A new round resets the server's annotation store (see
  // resetPlanRound), so re-syncing here clears the stale "Submitted" state + old comments
  // instead of carrying last round's feedback forward. `markdown` is the round signal: it is
  // stable within a round and only changes when a new/revised plan is pushed.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/plan/annotations", {
          cache: "no-store",
          headers: wsHeaders(currentPlanWs()),
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          annotations: TextAnnotation[];
          globalComment?: string;
          submitted: boolean;
        };
        if (!alive) return;
        setAnnotations(body.annotations ?? []);
        setGlobalComment(body.globalComment ?? "");
        setSubmitted(!!body.submitted);
      } catch {
        /* offline first run */
      }
    })();
    return () => {
      alive = false;
    };
  }, [markdown, round]);

  // Persist in-progress state via PUT. Stamped with the round so a stale tab's autosave
  // can't resurrect old comments into a freshly re-proposed round (server drops it).
  useEffect(() => {
    if (submitted) return;
    const t = setTimeout(() => {
      void fetch("/api/plan/annotations", {
        method: "PUT",
        headers: { "content-type": "application/json", ...wsHeaders(currentPlanWs()) },
        body: JSON.stringify({ annotations, globalComment, round }),
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [annotations, globalComment, submitted, round]);

  // Show floating popover whenever the user has an active selection inside the document.
  const refreshPopover = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setPopover(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      setPopover(null);
      return;
    }
    if (!docRef.current?.contains(sel.anchorNode)) return;
    const { x, y } = selectionAnchor(sel.getRangeAt(0));
    setPopover({ x, y, excerpt: text });
  }, []);

  useEffect(() => {
    const handler = () => setTimeout(refreshPopover, 0);
    document.addEventListener("mouseup", handler);
    document.addEventListener("selectionchange", handler);
    return () => {
      document.removeEventListener("mouseup", handler);
      document.removeEventListener("selectionchange", handler);
    };
  }, [refreshPopover]);

  const isPrintable = (e: KeyboardEvent) =>
    e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey;

  const addAnnotation = useCallback(
    (excerpt: string, kind: "comment" | "deletion" = "comment", seedChar = "") => {
      const id = `a-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      setAnnotations((a) => [...a, { id, excerpt, comment: seedChar, kind }]);
      // Remember which row to focus when the Comments tab in the canvas DetailSidebar
      // is opened next.
      if (kind === "comment") setFocusOnId(id);
      setPopover(null);
      window.getSelection()?.removeAllRanges();
    },
    [],
  );

  // Open the inline composer on the FIRST keystroke after a text selection — no need to click
  // the Comment button first. The typed character seeds the composer textarea, which then takes
  // focus so the rest of the comment types in normally.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().trim();
      if (!text) return;
      if (!docRef.current?.contains(sel.anchorNode)) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && /^(TEXTAREA|INPUT)$/.test(ae.tagName)) return;
      if (!isPrintable(e)) return;
      e.preventDefault();
      const range = sel.getRangeAt(0);
      pendingRangeRef.current = range.cloneRange();
      const { x, y } = selectionAnchor(range);
      setComposer({ x, y, excerpt: text, seed: e.key });
      setPopover(null);
      window.getSelection()?.removeAllRanges();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Paint the captured selection Range while the composer is open (and clear it on close), so the
  // text stays highlighted as you type. Decoupled from any excerpt matching, so it works for
  // selections spanning inline `code` / **bold**.
  useEffect(() => {
    const reg = highlightRegistry();
    if (!composer || !reg) return;
    const range = pendingRangeRef.current;
    if (!range) return;
    reg.set(PENDING_HL, makeHighlight(range));
    return () => {
      reg.delete(PENDING_HL);
    };
  }, [composer]);

  // Keep every SAVED annotation marked in the doc by re-locating its excerpt in the RENDERED text and
  // painting it via the Highlight API — so the mark survives after "Add" even for excerpts spanning
  // inline markdown (the raw-markdown indexOf matcher can't find those). Comments get a background
  // tint (beacon-annotation); deletions get a struck-through red mark (beacon-deletion) — ::highlight()
  // supports text-decoration. Unmark/remove lives in the Comments panel. Re-runs on comment/prose change.
  useEffect(() => {
    const reg = highlightRegistry();
    if (!reg || !docRef.current) return;
    const commentRanges: Range[] = [];
    const deletionRanges: Range[] = [];
    for (const a of annotations) {
      const r = findFirstTextRange(docRef.current, a.excerpt);
      if (!r) continue;
      ((a.kind ?? "comment") === "deletion" ? deletionRanges : commentRanges).push(r);
    }
    const apply = (key: string, ranges: Range[]) =>
      ranges.length ? reg.set(key, makeHighlight(...ranges)) : reg.delete(key);
    apply(ANNOT_HL, commentRanges);
    apply(DEL_HL, deletionRanges);
    return () => {
      reg.delete(ANNOT_HL);
      reg.delete(DEL_HL);
    };
  }, [annotations, markdown]);

  // Dismiss the overall-feedback popover on Escape or a click outside it. The pill's toggle
  // button lives in a different component, so it's tagged data-overall-toggle and excluded
  // here — otherwise its own click would close-then-reopen and the toggle would never close.
  useEffect(() => {
    if (!globalOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (globalPopoverRef.current?.contains(t)) return;
      if (t.closest("[data-overall-toggle]")) return;
      setGlobalOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGlobalOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [globalOpen]);

  const updateComment = (id: string, comment: string) =>
    setAnnotations((a) => a.map((x) => (x.id === id ? { ...x, comment } : x)));

  const removeAnnotation = (id: string) =>
    setAnnotations((a) => a.filter((x) => x.id !== id));

  // Drop every unsubmitted comment + the overall note, locally and on the server, so the parent's
  // "Clear to approve" unblocks Approve in one click. The PUT autosave is keyed on the same state,
  // so clearing here also persists the empty set; the explicit DELETE makes it immediate.
  const clearAll = () => {
    setAnnotations([]);
    setGlobalComment("");
    setGlobalOpen(false);
    void fetch("/api/plan/annotations", {
      method: "DELETE",
      headers: wsHeaders(currentPlanWs()),
    }).catch(() => {});
  };

  const onSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const extra = getExtraSubmitPayload?.() ?? {};
      const res = await fetch("/api/plan/annotations", {
        method: "POST",
        headers: { "content-type": "application/json", ...wsHeaders(currentPlanWs()) },
        // `round` lets the server refuse a submit from a tab still showing an older
        // round (the agent re-proposed meanwhile) instead of poisoning the new one.
        body: JSON.stringify({ annotations, globalComment, round, ...extra }),
      });
      if (res.ok) setSubmitted(true);
      // Stale round: this page is showing an outdated plan — reload to pick up the
      // current round rather than leaving the user editing feedback that can't land.
      else if (res.status === 409) window.location.reload();
    } finally {
      setSubmitting(false);
    }
  };

  const liveCount = useMemo(
    () =>
      annotations.filter(
        (a) => a.kind === "deletion" || a.comment.trim(),
      ).length + (globalComment.trim() ? 1 : 0),
    [annotations, globalComment],
  );

  // Lift submit handler + counts + annotation list + handlers so the parent's verdict
  // pill can render the controls and so the canvas DetailSidebar's Comments tab can
  // render the annotation list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    onApi?.({
      liveCount,
      submitting,
      submitted,
      submit: () => void onSubmit(),
      clearAll,
      annotationCount: annotations.length,
      hasGlobalComment: !!globalComment.trim(),
      globalOpen,
      toggleOverall: () => setGlobalOpen((b) => !b),
      annotations,
      updateComment,
      removeAnnotation,
      focusOnAnnotation: (id: string) => setFocusOnId(id),
      addComment: (excerpt: string) => addAnnotation(excerpt, "comment"),
    });
  }, [liveCount, submitting, submitted, annotations, globalComment, globalOpen]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* No toolbar — the Comments / Overall / Submit / Approve / Discard controls all
          live in the floating Plan pill at top-right. Hidden helpers below render the
          Submit button only when this panel is used standalone (hideSubmit=false) and the
          Overall feedback popover anchored where the toggle would have been. */}
      <div className="relative shrink-0">
        <div className="absolute right-3 top-2 z-30 flex items-center gap-1">
          {!hideSubmit && (
              <button
                onClick={() => void onSubmit()}
                disabled={submitting || liveCount === 0}
                className={cn(
                  "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors",
                  submitted
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : liveCount === 0
                      ? "border-border text-muted-foreground opacity-50"
                      : "border-sky-500/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25",
                )}
                title={
                  submitted
                    ? "Submitted — your terminal session is reading the feedback"
                    : "Submit all feedback so the agent can revise the plan"
                }
              >
                {submitted ? <Check className="size-3" /> : <Send className="size-3" />}
                {submitted ? "Submitted" : "Submit feedback"}
              </button>
            )}
            {globalOpen && (
              <div
                ref={globalPopoverRef}
                className="absolute right-0 top-[calc(100%+6px)] z-50 w-[320px] rounded-md border border-border bg-card p-2 shadow-xl"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Overall feedback
                  </span>
                  <button
                    onClick={() => setGlobalOpen(false)}
                    title="Close (Esc)"
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </div>
                <textarea
                  autoFocus
                  value={globalComment}
                  onChange={(e) => setGlobalComment(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    // ⌘/Ctrl+Enter submits; plain Enter and Shift+Enter insert a newline.
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      if (!submitting && liveCount > 0) {
                        void onSubmit();
                        setGlobalOpen(false);
                      }
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setGlobalOpen(false);
                    }
                  }}
                  placeholder="Plan-level notes — e.g. 'split this into two phases' or 'wrong abstraction'…"
                  rows={4}
                  className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-[12px] leading-snug outline-none focus:border-sky-400/40"
                />
                <div className="mt-1 text-right text-[9px] text-muted-foreground/70">
                  ⌘/Ctrl+Enter to submit · Esc to close
                </div>
              </div>
            )}
        </div>
      </div>

      <div
        ref={docRef}
        className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-16 text-[15px] leading-[1.6] selection:bg-[var(--accent-2,#ff7a45)]/30 shell:pt-0"
      >
        <RenderedMarkdown
          markdown={markdown}
          // While the composer is open the native selection is gone (the textarea owns focus). The
          // CSS Custom Highlight API keeps the exact Range painted (see the effect above). Only when
          // that API is unavailable do we fall back to the excerpt pseudo-annotation — which can't
          // re-locate a selection spanning inline markdown, but is better than nothing on old browsers.
          annotations={
            composer && !HIGHLIGHT_API
              ? [
                  ...annotations,
                  { id: "__pending", excerpt: composer.excerpt, comment: "", kind: "comment" as const },
                ]
              : annotations
          }
          focusOnId={focusOnId}
          onClearFocus={() => setFocusOnId(null)}
          onUpdate={updateComment}
          onRemove={removeAnnotation}
        />
      </div>

      {popover && (
        <div
          style={clampedFixed(popover.x + 4, popover.y + 6, 76, 34)}
          className="flex items-center gap-0.5 rounded-md border border-border bg-card/95 p-0.5 shadow-lg backdrop-blur"
        >
          <button
            onClick={() => {
              const sel = window.getSelection();
              pendingRangeRef.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
              setComposer({ ...popover, seed: "" });
              setPopover(null);
              sel?.removeAllRanges();
            }}
            title="Comment on this text"
            className="rounded p-1 text-sky-300 hover:bg-sky-500/15"
          >
            <MessageSquarePlus className="size-3.5" />
          </button>
          <button
            onClick={() => addAnnotation(popover.excerpt, "deletion")}
            title="Mark this for deletion"
            className="rounded p-1 text-red-300 hover:bg-red-500/15"
          >
            <Strikethrough className="size-3.5" />
          </button>
        </div>
      )}

      {/* Inline comment composer — type the comment right where you selected. On confirm it's
          saved and shows in the side-panel Comments list. */}
      {composer && (
        <InlineComposer
          excerpt={composer.excerpt}
          x={composer.x}
          y={composer.y}
          seed={composer.seed}
          onConfirm={(comment) => {
            addAnnotation(composer.excerpt, "comment", comment);
            setComposer(null);
          }}
          onCancel={() => setComposer(null)}
        />
      )}

      {/* Standalone Comments side panel removed — Comments now lives as a tab inside
          the canvas DetailSidebar (rendered by plan-workspace). */}
    </div>
  );
}

// Floating textarea anchored at the selection, with explicit Add / Discard buttons.
// Enter still saves and Esc still discards; clicking elsewhere keeps a non-empty comment
// (and drops an empty one) — but the buttons make the outcome a deliberate choice.
function InlineComposer({
  excerpt,
  x,
  y,
  seed,
  onConfirm,
  onCancel,
}: {
  excerpt: string;
  x: number;
  y: number;
  seed: string;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(seed);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Keep the composer fully on-screen: anchor just below the selection end, then clamp to the
  // viewport once we can measure the real box (w-64 + variable height). Without this it overflows
  // off the right edge for selections near the edge or spanning many lines.
  const [pos, setPos] = useState(() =>
    clampToViewport(x + 4, y + 6, 256, 130, window.innerWidth, window.innerHeight),
  );
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos(clampToViewport(x + 4, y + 6, width, height, window.innerWidth, window.innerHeight));
  }, [x, y]);
  const confirm = () => (value.trim() ? onConfirm(value.trim()) : onCancel());
  return (
    <div
      ref={boxRef}
      style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 60 }}
      className="w-64 rounded-md border border-border bg-card/95 p-1.5 shadow-xl backdrop-blur"
      // Only treat focus LEAVING the whole composer as an implicit save — focus moving from
      // the textarea to the buttons must not auto-confirm under the user's click.
      onBlur={(e) => {
        if (boxRef.current?.contains(e.relatedTarget as Node | null)) return;
        confirm();
      }}
    >
      <div className="mb-1 line-clamp-1 text-[10px] text-muted-foreground">“{excerpt}”</div>
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.setSelectionRange(value.length, value.length)}
        placeholder="Comment… (Enter to add · Esc to discard)"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            confirm();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className="h-16 w-full resize-none rounded bg-[var(--ink-hover)] px-1.5 py-1 text-xs outline-none placeholder:text-muted-foreground/50 focus:bg-[var(--ink-active)]"
      />
      <div className="mt-1 flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onCancel}
          title="Discard this comment (Esc)"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-red-500/15 hover:text-red-300"
        >
          <X className="size-3" />
          Discard
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!value.trim()}
          title="Add this comment (Enter)"
          className="flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300 transition-colors hover:bg-sky-500/25 disabled:opacity-40"
        >
          <Check className="size-3" />
          Add
        </button>
      </div>
    </div>
  );
}

// Reusable Comments list used by the canvas DetailSidebar's Comments tab. Keeps the
// rendering co-located with AnnotationPanel so the markup stays in sync.
export function CommentsList({
  annotations,
  updateComment,
  removeAnnotation,
  focusOnAnnotation,
  onClose,
}: {
  annotations: TextAnnotation[];
  updateComment: (id: string, comment: string) => void;
  removeAnnotation: (id: string) => void;
  focusOnAnnotation: (id: string) => void;
  onClose?: () => void;
}) {
  if (annotations.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[11px] text-muted-foreground">
        Highlight any text in the plan to leave an inline comment.
      </div>
    );
  }
  return (
    <ul className="space-y-1.5">
      {annotations.map((a) => (
        <li
          key={a.id}
          className={cn(
            "group rounded-md border bg-background/30 px-2 py-1.5 transition-colors hover:bg-background/50",
            a.kind === "deletion" ? "border-red-500/25" : "border-sky-500/15",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => {
                  focusOnAnnotation(a.id);
                  onClose?.();
                }}
                title="Jump to this excerpt in the plan"
                className={cn(
                  "block w-full truncate text-left text-[10.5px] font-mono",
                  a.kind === "deletion"
                    ? "text-red-300/90 line-through"
                    : "text-foreground/80 hover:text-foreground",
                )}
              >
                “{a.excerpt}”
              </button>
              {a.kind !== "deletion" && (
                <textarea
                  value={a.comment}
                  onChange={(e) => updateComment(a.id, e.target.value)}
                  placeholder="Write your comment…"
                  rows={1}
                  className="field-sizing-content mt-1 w-full resize-none bg-transparent text-[11px] leading-snug text-foreground/90 outline-none placeholder:text-muted-foreground/60 focus:text-foreground"
                />
              )}
            </div>
            <button
              onClick={() => removeAnnotation(a.id)}
              title="Remove this annotation"
              className="shrink-0 rounded p-1 text-muted-foreground/70 opacity-0 transition-opacity hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// Block parsing + the fenced-code renderer are shared with the history view — see
// components/plan/markdown-view.tsx (splitBlocks / CodeBlock / Block).

function RenderedMarkdown({
  markdown,
  annotations,
  focusOnId,
  onClearFocus,
  onUpdate,
  onRemove,
}: {
  markdown: string;
  annotations: TextAnnotation[];
  focusOnId: string | null;
  onClearFocus: () => void;
  onUpdate: (id: string, comment: string) => void;
  onRemove: (id: string) => void;
}) {
  const blocks = useMemo(() => splitBlocks(markdown), [markdown]);
  return (
    // Centered ~66ch measure: the comfortable reading column, applied in every layout (split,
    // expanded, and full-width no-board) so lines never run the full monitor width.
    <div className="mx-auto w-full max-w-[66ch] space-y-4">
      {blocks.map((b, i) => (
        <RenderedBlock
          key={i}
          block={b}
          index={i}
          annotations={annotations}
          focusOnId={focusOnId}
          onClearFocus={onClearFocus}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function RenderedBlock({
  block,
  index,
  annotations,
  focusOnId,
  onClearFocus,
  onUpdate,
  onRemove,
}: {
  block: Block;
  index: number;
  annotations: TextAnnotation[];
  focusOnId: string | null;
  onClearFocus: () => void;
  onUpdate: (id: string, comment: string) => void;
  onRemove: (id: string) => void;
}) {
  // Fenced code renders verbatim (monospace, no inline */backtick parsing that would mangle
  // JSON) — and isn't run through the annotation matcher. Tables likewise render as a real
  // <table> (many inline cells) outside the annotation matcher.
  if (block.kind === "code") return <CodeBlock text={block.text} />;
  if (block.kind === "table") return <TableBlock block={block} />;
  const content = (
    <AnnotatedInline
      text={block.text}
      annotations={annotations}
      focusOnId={focusOnId}
      onClearFocus={onClearFocus}
      onUpdate={onUpdate}
      onRemove={onRemove}
    />
  );
  // Headings get a stable anchor id (keyed on block index) so the section TOC can scroll to
  // them. All block styling lives in the shared renderBlockShell so the panel and the history
  // view can't drift.
  const anchorId = isHeading(block.kind) ? planHeadingAnchor(index) : undefined;
  return <>{renderBlockShell(block, content, "reading", anchorId)}</>;
}

function AnnotatedInline({
  text,
  annotations,
  focusOnId,
  onClearFocus,
  onUpdate,
  onRemove,
}: {
  text: string;
  annotations: TextAnnotation[];
  focusOnId: string | null;
  onClearFocus: () => void;
  onUpdate: (id: string, comment: string) => void;
  onRemove: (id: string) => void;
}) {
  // When the CSS Highlight API is available, BOTH comments and deletions are painted by it (robust to
  // inline markdown — see the effect in AnnotationPanel), so no inline spans are needed. Only on
  // browsers without the API do we fall back to wrapping the matched excerpts here.
  const matches = (HIGHLIGHT_API ? [] : annotations)
    .map((a) => ({ a, idx: text.indexOf(a.excerpt) }))
    .filter((m) => m.idx >= 0)
    .sort((x, y) => x.idx - y.idx);

  if (!matches.length) return <BasicInline text={text} />;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const { a, idx } of matches) {
    if (idx < cursor) continue;
    if (idx > cursor) parts.push(<BasicInline key={`p-${cursor}`} text={text.slice(cursor, idx)} />);
    parts.push(
      <AnnotatedSpan
        key={a.id}
        annotation={a}
        autoFocus={focusOnId === a.id}
        onClearFocus={onClearFocus}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />,
    );
    cursor = idx + a.excerpt.length;
  }
  if (cursor < text.length) parts.push(<BasicInline key={`p-tail`} text={text.slice(cursor)} />);
  return <>{parts}</>;
}

function AnnotatedSpan({
  annotation,
  autoFocus,
  onClearFocus,
  onUpdate,
  onRemove,
}: {
  annotation: TextAnnotation;
  autoFocus: boolean;
  onClearFocus: () => void;
  onUpdate: (id: string, comment: string) => void;
  onRemove: (id: string) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (autoFocus && taRef.current) {
      taRef.current.focus();
      // Put cursor at end so the auto-typed first character flows naturally.
      const v = taRef.current.value;
      taRef.current.setSelectionRange(v.length, v.length);
      onClearFocus();
    }
  }, [autoFocus, onClearFocus]);

  const kind = annotation.kind ?? "comment";
  if (kind === "deletion") {
    return (
      <span className="relative inline">
        <span className="rounded bg-red-500/15 px-0.5 text-red-200/90 line-through decoration-red-300/70 decoration-2">
          <BasicInline text={annotation.excerpt} />
        </span>
        <button
          type="button"
          onClick={() => onRemove(annotation.id)}
          title="Unmark"
          className="ml-0.5 inline-flex translate-y-[-1px] items-center text-red-300/70 hover:text-red-300"
        >
          <Trash2 className="size-3" />
        </button>
      </span>
    );
  }

  // Inline comment textarea was removed — the comment editor now lives exclusively in
  // the right-side Comments panel. The highlighted span here just marks the excerpt so
  // the user can scroll back to it; the autoFocus effect above is a no-op now and the
  // unused refs are kept tiny.
  void taRef; void onUpdate;
  return (
    <span
      className="rounded bg-[var(--accent-2,#ff7a45)]/15 px-0.5"
      data-annotation-id={annotation.id}
    >
      <BasicInline text={annotation.excerpt} />
    </span>
  );
}

// Inline markdown for non-annotated text runs — shares the one renderer with the history
// view (handles `code`, **bold**, *emphasis*) so they can't drift apart.
function BasicInline({ text }: { text: string }) {
  return <Inline text={text} />;
}
