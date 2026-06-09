"use client";

import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Lightweight markdown renderer shared by the annotation panel and the history view.
// Supports just what plans emit: # / ## / ### / - lists / ```fenced code``` / `inline code` /
// *emphasis*. No deps so it stays tiny — react-markdown would be ~50× the size here.

export function MarkdownView({
  markdown,
  className,
  variant = "reading",
}: {
  markdown: string;
  className?: string;
  /** "reading" (default) — comfortable size, a centered ~66ch measure, real heading
      hierarchy — for the /plan surfaces. "compact" — today's dense sizing, no measure
      cap — for narrow canvas cards (node-card, detail-sidebar). */
  variant?: MdVariant;
}) {
  const blocks = useMemo(() => splitBlocks(markdown), [markdown]);
  const reading = variant === "reading";
  return (
    <div
      className={cn(
        // overflow-wrap:anywhere (NOT break-words) keeps long unbreakable tokens
        // (code, URLs) from forcing the card/panel wider than its container — only
        // `anywhere` also shrinks min-content so flex children can wrap. It inherits,
        // so inline <code> breaks too. min-w-0 lets the renderer shrink in flex parents.
        "min-w-0 [overflow-wrap:anywhere]",
        // Measure: capping the column at ~66ch (the readability sweet spot) and centering
        // it keeps lines comfortable even when the panel goes full-width (no board).
        reading
          ? "mx-auto w-full max-w-[66ch] space-y-4 text-[15px] leading-[1.6]"
          : "space-y-3.5 text-[13px] leading-relaxed",
        className,
      )}
    >
      {blocks.map((b, i) => (
        <RenderedBlock key={i} block={b} variant={variant} />
      ))}
    </div>
  );
}

export interface Block {
  kind: "h1" | "h2" | "h3" | "h4" | "ul" | "ol" | "quote" | "p" | "code" | "table";
  text: string;
  /** Nesting level for ul/ol (0-based) — driven by source indentation. */
  depth?: number;
  /** Ordered-list number as written (e.g. "1") — set for ol only. */
  marker?: string;
  /** GFM table cells (table only): rows[0] = header, the rest are body rows. Each cell is raw
      inline markdown, rendered through <Inline>. */
  rows?: string[][];
  /** GFM table per-column alignment (table only), parsed from the `:--`/`:-:`/`--:` separator. */
  align?: (TableAlign | null)[];
}

export type TableAlign = "left" | "center" | "right";

// A GFM table separator row, e.g. `|---|:--:|--:|`. Must contain a pipe (so a bare `---`
// horizontal rule isn't mistaken for one), at least one dash, and nothing but |/:/-/space.
function isTableSep(s: string): boolean {
  const t = s.trim();
  return t.includes("|") && t.includes("-") && /^[\s|:-]+$/.test(t);
}

// A candidate table row: non-empty and contains a pipe. (The separator-row check on the NEXT
// line is what actually confirms it's a table, in splitBlocks.)
function isTableRow(s: string): boolean {
  return s.trim() !== "" && s.includes("|");
}

// Split `| a | b |` into ["a","b"] — tolerant of missing leading/trailing pipes.
function parseCells(row: string): string[] {
  let s = row.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

// `:--` → left, `:-:` → center, `--:` → right, else null (default).
function cellAlign(sepCell: string): TableAlign | null {
  const c = sepCell.trim();
  const l = c.startsWith(":");
  const r = c.endsWith(":");
  if (l && r) return "center";
  if (r) return "right";
  if (l) return "left";
  return null;
}

// A line that is just a ``` fence, optionally with a language (```json) — the whole line, so
// inline triple-backticks in prose don't trip it.
const FENCE = /^\s*```[^\s`]*\s*$/;

export function splitBlocks(md: string): Block[] {
  const lines = md.split("\n");
  const out: Block[] = [];
  let buf: string[] = [];
  const flushPara = () => {
    if (!buf.length) return;
    out.push({ kind: "p", text: buf.join("\n") });
    buf = [];
  };
  // Consecutive `> ` lines merge into a single blockquote block.
  let quote: string[] | null = null;
  const flushQuote = () => {
    if (quote === null) return;
    out.push({ kind: "quote", text: quote.join("\n") });
    quote = null;
  };
  // List indentation → nesting depth: 2 spaces per level, capped so pathological indentation
  // can't push content off-canvas.
  const depthOf = (indent: string) => Math.min(6, Math.floor(indent.length / 2));
  // Fenced code blocks render verbatim (no #/-/inline parsing inside) — JSON, snippets, etc.
  let code: string[] | null = null;
  // Index in `out` of a list item still open for LAZY CONTINUATION: a hard-wrapped list item
  // spills onto unindented following lines, e.g. `1. … on the **real\narchitecture …**`. Those
  // continuation lines must join the item (one block) — otherwise the wrap splits a **bold** /
  // *italic* span across two blocks and the markers leak as literal text. A blank line or any
  // new block closes it.
  let listIdx: number | null = null;
  // Indexed loop (not for..of) so table detection can look one line ahead for the separator row.
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (code !== null) {
      if (FENCE.test(raw)) {
        out.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else {
        code.push(raw);
      }
      continue;
    }
    // A `>` line opens/extends a blockquote; any other line closes the open quote first.
    const bq = raw.match(/^>\s?(.*)$/);
    if (bq) { flushPara(); listIdx = null; (quote ??= []).push(bq[1]); continue; }
    flushQuote();
    if (FENCE.test(raw)) { flushPara(); listIdx = null; code = []; continue; }
    if (/^\s*$/.test(raw)) { flushPara(); listIdx = null; continue; }
    // Headings: deepest first — each requires its exact hash count + a space, so they're
    // mutually exclusive (a `## x` never matches the `# ` pattern).
    const h4 = raw.match(/^#### +(.+)$/);
    if (h4) { flushPara(); listIdx = null; out.push({ kind: "h4", text: h4[1] }); continue; }
    const h3 = raw.match(/^### +(.+)$/);
    if (h3) { flushPara(); listIdx = null; out.push({ kind: "h3", text: h3[1] }); continue; }
    const h2 = raw.match(/^## +(.+)$/);
    if (h2) { flushPara(); listIdx = null; out.push({ kind: "h2", text: h2[1] }); continue; }
    const h1 = raw.match(/^# +(.+)$/);
    if (h1) { flushPara(); listIdx = null; out.push({ kind: "h1", text: h1[1] }); continue; }
    // GFM table: a row of pipes immediately followed by a |---|---| separator. Without the
    // separator a line with pipes is just prose (e.g. a shell `a | b`), so both are required.
    if (isTableRow(raw) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara();
      listIdx = null;
      const rows = [parseCells(raw)];
      const align = parseCells(lines[i + 1]).map(cellAlign);
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j]) && !isTableSep(lines[j])) {
        rows.push(parseCells(lines[j]));
        j++;
      }
      out.push({ kind: "table", text: lines.slice(i, j).join("\n"), rows, align });
      i = j - 1; // resume after the table (the loop's i++ steps past the last consumed row)
      continue;
    }
    const ol = raw.match(/^(\s*)(\d+)\. +(.+)$/);
    if (ol) { flushPara(); out.push({ kind: "ol", text: ol[3], depth: depthOf(ol[1]), marker: ol[2] }); listIdx = out.length - 1; continue; }
    const ul = raw.match(/^(\s*)- +(.+)$/);
    if (ul) { flushPara(); out.push({ kind: "ul", text: ul[2], depth: depthOf(ul[1]) }); listIdx = out.length - 1; continue; }
    // Lazy continuation of the open list item (soft wrap → join with a space).
    if (listIdx !== null && buf.length === 0) {
      out[listIdx].text += " " + raw.trim();
      continue;
    }
    buf.push(raw);
  }
  flushPara();
  flushQuote();
  // Unterminated fence — still render what we captured rather than dropping it.
  if (code !== null) out.push({ kind: "code", text: code.join("\n") });
  return out;
}

// Pretty-print a JSON object/array string for display (2-space indent), or null when it isn't
// JSON. Turns a crammed one-liner into scannable indented lines — the big readability win.
export function formatMaybeJson(text: string): string | null {
  const t = text.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return null;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return null;
  }
}

// Minimal, dependency-free JSON syntax highlighter: keys, string values, numbers,
// booleans/null; everything else (braces, commas, whitespace) is dim punctuation.
const JSON_TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlightJson(json: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  const punct = (s: string) => (
    <span key={key++} className="text-foreground/45">
      {s}
    </span>
  );
  let m: RegExpExecArray | null;
  JSON_TOKEN.lastIndex = 0;
  while ((m = JSON_TOKEN.exec(json)) !== null) {
    if (m.index > last) nodes.push(punct(json.slice(last, m.index)));
    if (m[1] !== undefined) {
      const isKey = m[2] !== undefined;
      nodes.push(
        <span key={key++} className={isKey ? "text-sky-300" : "text-emerald-300/90"}>
          {m[1]}
        </span>,
      );
      if (isKey && m[2]) nodes.push(punct(m[2]));
    } else if (m[3] !== undefined) {
      nodes.push(
        <span key={key++} className="text-purple-300">
          {m[3]}
        </span>,
      );
    } else if (m[4] !== undefined) {
      nodes.push(
        <span key={key++} className="text-amber-300">
          {m[4]}
        </span>,
      );
    }
    last = JSON_TOKEN.lastIndex;
  }
  if (last < json.length) nodes.push(punct(json.slice(last)));
  return nodes;
}

// Shared fenced-code renderer: monospace on a soft gray surface (easier on the eyes than pure
// black), preserves whitespace, scrolls horizontally. JSON is pretty-printed + highlighted;
// anything else renders verbatim (no inline */backtick parsing).
export function CodeBlock({ text }: { text: string }) {
  const json = formatMaybeJson(text);
  return (
    <pre className="overflow-x-auto rounded-lg border border-white/10 bg-white/[0.06] p-3 text-[12px] leading-relaxed">
      <code className="whitespace-pre font-mono [overflow-wrap:normal]">
        {json ? highlightJson(json) : <span className="text-foreground/85">{text}</span>}
      </code>
    </pre>
  );
}

// GFM table renderer: a real <table> wrapped in a horizontally-scrollable container so a wide
// table (many columns) scrolls instead of mangling the column into stacked wrapped text — the
// reported bug. Cells render inline markdown (**bold**, `code`, *em*). Like CodeBlock, it's
// handled by the block callers directly (it has many inline cells, so it doesn't fit the single
// `inline` node that renderBlockShell takes) and is never run through the annotation matcher.
export function TableBlock({ block }: { block: Block }) {
  const rows = block.rows ?? [];
  if (rows.length === 0) return null;
  const [head, ...body] = rows;
  const align = block.align ?? [];
  const alignClass = (i: number) =>
    align[i] === "center" ? "text-center" : align[i] === "right" ? "text-right" : "text-left";
  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full border-collapse text-[13px] [overflow-wrap:normal]">
        <thead>
          <tr className="border-b border-white/15 bg-white/[0.04]">
            {head.map((c, i) => (
              <th
                key={i}
                className={cn(
                  "whitespace-nowrap px-3 py-1.5 font-semibold text-foreground",
                  alignClass(i),
                )}
              >
                <Inline text={c} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className="border-b border-white/5 last:border-0">
              {r.map((c, ci) => (
                <td key={ci} className={cn("px-3 py-1.5 align-top text-foreground/90", alignClass(ci))}>
                  <Inline text={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type MdVariant = "reading" | "compact";

// --- Section TOC helpers (shared so the panel's heading ids and the TOC's links agree) ---

const HEADING_KINDS: Block["kind"][] = ["h1", "h2", "h3", "h4"];

export function isHeading(kind: Block["kind"]): boolean {
  return HEADING_KINDS.includes(kind);
}

// h1 → 0 … h4 → 3, for TOC indentation. Non-headings return 0.
export function headingLevel(kind: Block["kind"]): number {
  const i = HEADING_KINDS.indexOf(kind);
  return i < 0 ? 0 : i;
}

// Stable id for the Nth block — used both as the heading element's id and the TOC link target,
// keyed on the block's index in splitBlocks() so both sides resolve to the same anchor.
export function planHeadingAnchor(blockIndex: number): string {
  return `plan-h-${blockIndex}`;
}

// Strip inline markdown markers (**bold**, *em*, `code`) so TOC labels read as plain text.
export function stripInline(text: string): string {
  return text.replace(/[`*]/g, "").trim();
}

// Single source of truth for block markup + styling, shared by the plain MarkdownView and the
// annotation panel's annotation-aware renderer so the two can't drift. `inline` is the
// already-rendered inline content (either <Inline> here, or <AnnotatedInline> in the panel).
// Code blocks are NOT handled here — callers render them via <CodeBlock> (they take no inline
// node and are never run through the annotation matcher).
export function renderBlockShell(
  block: Block,
  inline: ReactNode,
  variant: MdVariant,
  // When set (headings only), the element gets this id so the section TOC can scroll to it.
  // `scroll-mt` keeps the scrolled-to heading clear of the floating controls at the top.
  anchorId?: string,
): ReactNode {
  const reading = variant === "reading";
  switch (block.kind) {
    case "h1":
      return (
        <h1
          id={anchorId}
          className={
            reading
              ? "scroll-mt-24 text-xl font-semibold tracking-tight text-foreground"
              : "text-base font-semibold text-foreground"
          }
        >
          {inline}
        </h1>
      );
    case "h2":
      return (
        <h2
          id={anchorId}
          className={
            reading
              ? "mt-6 scroll-mt-24 border-b border-white/10 pb-1 text-lg font-semibold text-foreground"
              : "mt-3 text-sm font-semibold text-muted-foreground"
          }
        >
          {inline}
        </h2>
      );
    case "h3":
      return (
        <h3
          id={anchorId}
          className={
            reading
              ? "mt-4 scroll-mt-24 text-base font-semibold text-foreground"
              : "mt-2 text-[13px] font-semibold text-foreground"
          }
        >
          {inline}
        </h3>
      );
    case "h4":
      return (
        <h4
          id={anchorId}
          className={
            reading
              ? "mt-3 scroll-mt-24 text-sm font-semibold text-muted-foreground"
              : "mt-2 text-[13px] font-semibold text-muted-foreground"
          }
        >
          {inline}
        </h4>
      );
    case "ul":
    case "ol": {
      const depth = block.depth ?? 0;
      return (
        // Indent by nesting depth; the 0.75rem base matches the old `ml-3` bullet column.
        <div
          className={cn("flex gap-2", reading ? "text-foreground/95" : "text-foreground/90")}
          style={{ marginLeft: `${0.75 + depth * 1.25}rem` }}
        >
          <span className="shrink-0 select-none text-muted-foreground tabular-nums">
            {block.kind === "ol" ? `${block.marker}.` : "•"}
          </span>
          {/* min-w-0 + flex-1 let the text column shrink so long code tokens wrap instead of
              pushing the marker (and the whole panel) wider. */}
          <span className="min-w-0 flex-1">{inline}</span>
        </div>
      );
    }
    case "quote":
      return (
        <blockquote
          className={cn(
            "whitespace-pre-wrap border-l-2 pl-3 italic",
            reading ? "border-white/15 text-foreground/80" : "border-white/10 text-foreground/75",
          )}
        >
          {inline}
        </blockquote>
      );
    default: // "p"
      return (
        <p className={cn("whitespace-pre-wrap", reading ? "text-foreground/95" : "text-foreground/90")}>
          {inline}
        </p>
      );
  }
}

function RenderedBlock({ block, variant }: { block: Block; variant: MdVariant }) {
  if (block.kind === "code") return <CodeBlock text={block.text} />;
  if (block.kind === "table") return <TableBlock block={block} />;
  return <>{renderBlockShell(block, <Inline text={block.text} />, variant)}</>;
}

// Inline markdown: `code`, **bold**, *emphasis*. Bold MUST be tried before emphasis (its
// pattern is listed first in the split) so `**x**` isn't mis-read as `*` + `*x*` + `*` —
// which is what left stray asterisks in the rendered prose. Bold/emphasis recurse so inline
// `code` nested inside them still renders.
export function Inline({ text }: { text: string }) {
  // Bold uses a non-greedy [\s\S]+? (not [^*]+) so the bold span may CONTAIN a stray asterisk
  // — e.g. **`/admin/crawl/*` is gated…** — which otherwise broke the match and leaked literal
  // `**`. Bold is listed before emphasis so `**x**` isn't read as `*` + `*x*` + `*`.
  const parts = text.split(/(`[^`]+`|\*\*[\s\S]+?\*\*|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^`[^`]+`$/.test(p)) {
          return (
            <code key={i} className="rounded bg-white/5 px-1 font-mono text-[12px]">
              {p.slice(1, -1)}
            </code>
          );
        }
        if (/^\*\*[\s\S]+\*\*$/.test(p)) {
          return (
            <strong key={i} className="font-semibold text-foreground">
              <Inline text={p.slice(2, -2)} />
            </strong>
          );
        }
        if (/^\*[^*]+\*$/.test(p)) {
          return (
            <em key={i} className="text-muted-foreground">
              <Inline text={p.slice(1, -1)} />
            </em>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}
