"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, HelpCircle, X } from "lucide-react";
import {
  splitBlocks,
  CodeBlock,
  TableBlock,
  Inline,
  renderBlockShell,
  isHeading,
  type Block,
} from "@/components/plan/markdown-view";

// The left pane of /learn: the agent's plain-English narrative, where the user HIGHLIGHTS any text
// to ask the agent a question. It's the learning analog of the plan annotation panel — same
// CSS-Custom-Highlight selection flow — but a highlight asks a QUESTION (there is no "mark for
// deletion"), and answered questions paint in a settled color with their answer on click. The
// renderer reuses the shared markdown primitives (markdown-view), so backticked real file paths are
// clickable exactly as on /plan (the page wraps this in a FileMentionProvider).

const HIGHLIGHT_API =
  typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
const PENDING_HL = "lesson-pending"; // the span being asked about right now (composer open)
const ASK_HL = "lesson-ask"; // every unanswered question's excerpt
const ANSWERED_HL = "lesson-answered"; // every answered question's excerpt

function highlightRegistry(): Map<string, unknown> | null {
  if (!HIGHLIGHT_API) return null;
  return (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
}
function makeHighlight(...ranges: Range[]): unknown {
  const Ctor = (globalThis as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
  return new Ctor(...ranges);
}

// Locate `query` in the RENDERED text (so excerpts spanning inline `code`/**bold** still match —
// the markers aren't in the DOM) and return a Range. Skips fenced code + tables. Ported from the
// plan annotation panel.
function findFirstTextRange(root: HTMLElement, query: string): Range | null {
  if (!query) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest("pre, table") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
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

export interface TextQuestion {
  id: string;
  excerpt: string;
  question: string;
}

// Answered text questions (anchor.kind === "text") the agent has already responded to — painted
// in a settled color so the user can re-read the answer.
export interface AnsweredText {
  excerpt: string;
  answer: string;
}

export interface NarrativeApi {
  textQuestions: TextQuestion[];
  count: number;
  removeQuestion: (id: string) => void;
  clearAll: () => void;
}

export function LessonNarrativePanel({
  narrative,
  round,
  answered = [],
  onApi,
}: {
  narrative: string;
  /** Bumps each round (lesson.updatedAt) so pending questions reset when a new lesson arrives. */
  round?: number;
  answered?: AnsweredText[];
  onApi?: (api: NarrativeApi) => void;
}) {
  const [questions, setQuestions] = useState<TextQuestion[]>([]);
  const [popover, setPopover] = useState<{ x: number; y: number; excerpt: string } | null>(null);
  const [composer, setComposer] = useState<{ x: number; y: number; excerpt: string } | null>(null);
  const docRef = useRef<HTMLDivElement | null>(null);
  const pendingRangeRef = useRef<Range | null>(null);

  // A fresh lesson round clears last round's pending questions.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuestions([]);
  }, [round]);

  const refreshPopover = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return setPopover(null);
    const textSel = sel.toString().trim();
    if (!textSel || !docRef.current?.contains(sel.anchorNode)) return setPopover(null);
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setPopover({ x: rect.right + window.scrollX, y: rect.top + window.scrollY, excerpt: textSel });
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

  const addQuestion = useCallback((excerpt: string, question: string) => {
    setQuestions((q) => [
      ...q,
      { id: `tq-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, excerpt, question },
    ]);
  }, []);
  const removeQuestion = useCallback((id: string) => setQuestions((q) => q.filter((x) => x.id !== id)), []);
  const clearAll = useCallback(() => setQuestions([]), []);

  // Paint the captured selection while the composer is open.
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

  // Paint saved pending questions (ASK_HL) and answered ones (ANSWERED_HL).
  useEffect(() => {
    const reg = highlightRegistry();
    if (!reg || !docRef.current) return;
    const ask: Range[] = [];
    const ans: Range[] = [];
    for (const q of questions) {
      const r = findFirstTextRange(docRef.current, q.excerpt);
      if (r) ask.push(r);
    }
    for (const a of answered) {
      const r = findFirstTextRange(docRef.current, a.excerpt);
      if (r) ans.push(r);
    }
    const apply = (key: string, ranges: Range[]) =>
      ranges.length ? reg.set(key, makeHighlight(...ranges)) : reg.delete(key);
    apply(ASK_HL, ask);
    apply(ANSWERED_HL, ans);
    return () => {
      reg.delete(ASK_HL);
      reg.delete(ANSWERED_HL);
    };
  }, [questions, answered, narrative]);

  const count = useMemo(() => questions.filter((q) => q.question.trim()).length, [questions]);

  useEffect(() => {
    onApi?.({ textQuestions: questions, count, removeQuestion, clearAll });
  }, [questions, count, removeQuestion, clearAll, onApi]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={docRef}
        className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-16 text-[15px] leading-[1.6] selection:bg-[var(--accent-2,#ff7a45)]/30"
      >
        <RenderedNarrative markdown={narrative} />
      </div>

      {popover && (
        <div
          style={{ position: "fixed", left: popover.x + 4, top: popover.y - 34, zIndex: 60 }}
          className="rounded-md border border-white/15 bg-card/95 p-0.5 shadow-lg backdrop-blur"
        >
          <button
            onClick={() => {
              const sel = window.getSelection();
              pendingRangeRef.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
              setComposer({ ...popover });
              setPopover(null);
              sel?.removeAllRanges();
            }}
            title="Ask the agent about this"
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-[var(--accent-2,#ff7a45)] hover:bg-[var(--accent-2,#ff7a45)]/15"
          >
            <HelpCircle className="size-3.5" /> Ask
          </button>
        </div>
      )}

      {composer && (
        <QuestionComposer
          excerpt={composer.excerpt}
          x={composer.x}
          y={composer.y}
          onConfirm={(q) => {
            addQuestion(composer.excerpt, q);
            setComposer(null);
          }}
          onCancel={() => setComposer(null)}
        />
      )}
    </div>
  );
}

function QuestionComposer({
  excerpt,
  x,
  y,
  onConfirm,
  onCancel,
}: {
  excerpt: string;
  x: number;
  y: number;
  onConfirm: (q: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const confirm = () => (value.trim() ? onConfirm(value.trim()) : onCancel());
  return (
    <div
      ref={boxRef}
      style={{ position: "fixed", left: x + 4, top: y - 6, zIndex: 60 }}
      className="w-72 rounded-md border border-white/15 bg-card/95 p-1.5 shadow-xl backdrop-blur"
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
        placeholder="Ask the agent… (Enter to ask · Esc to discard)"
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
        className="h-16 w-full resize-none rounded bg-white/[0.05] px-1.5 py-1 text-xs outline-none placeholder:text-muted-foreground/50 focus:bg-white/[0.08]"
      />
      <div className="mt-1 flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-red-500/15 hover:text-red-300"
        >
          <X className="size-3" /> Discard
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!value.trim()}
          className="flex items-center gap-1 rounded bg-[var(--accent-2,#ff7a45)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-2,#ff7a45)] hover:bg-[var(--accent-2,#ff7a45)]/25 disabled:opacity-40"
        >
          <Check className="size-3" /> Ask
        </button>
      </div>
    </div>
  );
}

// Renders the question highlight styles once (the CSS Highlight API needs ::highlight() rules).
function RenderedNarrative({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => splitBlocks(markdown), [markdown]);
  return (
    <div className="mx-auto w-full max-w-[66ch] space-y-4">
      <style>{`
        ::highlight(${PENDING_HL}) { background: color-mix(in srgb, var(--accent-2,#ff7a45) 30%, transparent); }
        ::highlight(${ASK_HL}) { background: color-mix(in srgb, var(--accent-2,#ff7a45) 18%, transparent); }
        ::highlight(${ANSWERED_HL}) { background: color-mix(in srgb, #34d399 16%, transparent); }
      `}</style>
      {blocks.map((b, i) => (
        <NarrativeBlock key={i} block={b} index={i} />
      ))}
    </div>
  );
}

// Heading anchor id for the Nth block — the walkthrough (Phase 5) scrolls the narrative to a
// step's narrativeAnchor, which is one of these.
export function lessonHeadingAnchor(blockIndex: number): string {
  return `lesson-h-${blockIndex}`;
}

function NarrativeBlock({ block, index }: { block: Block; index: number }) {
  if (block.kind === "code") return <CodeBlock text={block.text} />;
  if (block.kind === "table") return <TableBlock block={block} />;
  const anchorId = isHeading(block.kind) ? lessonHeadingAnchor(index) : undefined;
  return <>{renderBlockShell(block, <Inline text={block.text} />, "reading", anchorId)}</>;
}
