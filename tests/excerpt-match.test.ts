import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findExcerptSpan } from "@/lib/excerpt-match";

// Reported: "when i highlight big texts to give a feedback they dont stay highlighted although
// small texts do". The excerpt comes from selection.toString(), which puts a NEWLINE at every block
// boundary; the haystack is the concatenation of the rendered DOM's text nodes, which has no
// separator. So any selection crossing a paragraph or list item could never be found again.

describe("findExcerptSpan", () => {
  it("finds a selection that spans two blocks, where the excerpt carries newlines", () => {
    // What the DOM concatenation looks like: no separator between blocks.
    const rendered = "First paragraph.Second paragraph.";
    // What selection.toString() gives for the same span: a newline at the boundary.
    const excerpt = "paragraph.\nSecond";
    const span = findExcerptSpan(rendered, excerpt);
    expect(span).not.toBeNull();
    expect(rendered.slice(span!.start, span!.end)).toBe("paragraph.Second");
  });

  it("handles the blank-line form browsers use between paragraphs", () => {
    const rendered = "Alone this does not end the outage.It ships first because it's small.";
    const span = findExcerptSpan(rendered, "the outage.\n\nIt ships first");
    expect(rendered.slice(span!.start, span!.end)).toBe("the outage.It ships first");
  });

  it("still matches when the rendered text collapses a run of whitespace", () => {
    const rendered = "The soft-deleted-address risk — the partial index has no deleted_at filter";
    const span = findExcerptSpan(rendered, "index   has\n no deleted_at");
    expect(rendered.slice(span!.start, span!.end)).toBe("index has no deleted_at");
  });

  it("takes the exact path when the text matches verbatim (the common, single-block case)", () => {
    const rendered = "Products/prices/stock, though PR 2 fixes their status codes.";
    expect(findExcerptSpan(rendered, "PR 2 fixes")).toEqual({ start: 30, end: 40 });
  });

  it("returns the FIRST occurrence, matching the old exact-match behaviour", () => {
    expect(findExcerptSpan("aa bb aa", "aa")).toEqual({ start: 0, end: 2 });
  });

  it("does not match text that genuinely isn't there (the passage was edited away)", () => {
    expect(findExcerptSpan("Some rendered prose.", "an excerpt from a deleted paragraph")).toBeNull();
  });

  it("never returns a span for empty input", () => {
    expect(findExcerptSpan("", "x")).toBeNull();
    expect(findExcerptSpan("x", "")).toBeNull();
    expect(findExcerptSpan("x", "   ")).toBeNull();
  });

  it("maps back to the ORIGINAL offsets, so a leading newline doesn't shift the range", () => {
    const rendered = "\n\n  Heading\nBody text here";
    const span = findExcerptSpan(rendered, "Heading Body");
    expect(rendered.slice(span!.start, span!.end)).toBe("Heading\nBody");
  });

  it("matches a long multi-block excerpt end to end", () => {
    const rendered =
      "PR 3 — Per-record outcomesImplement option D. On page failure, isolate per record, " +
      "commit the good ones, return 200 with skipped_ids.";
    const excerpt =
      "Per-record outcomes\n\nImplement option D. On page failure, isolate per record,\n" +
      "commit the good ones, return 200 with skipped_ids.";
    const span = findExcerptSpan(rendered, excerpt);
    expect(span!.end).toBe(rendered.length);
    expect(rendered.slice(span!.start, span!.end)).toContain("Per-record outcomesImplement");
  });
});

// Reported: selecting a whole section that CONTAINS A TABLE didn't stick, while a table-free
// section did. The DOM walk that builds the haystack skips `pre` and `table`, but
// selection.toString() includes every cell — so words in the middle of the excerpt don't exist in
// the haystack at all, and no whitespace normalising can bridge that.
describe("findExcerptSpan — content the haystack omits (tables, code fences)", () => {
  // The real F5 section: prose, a schedule table, more prose. The haystack has no table text.
  const before =
    "F5 — Per-record outcomes via bisectionReturn 200 with skipped_ids so one poisoned record " +
    "can't block a page. Isolate by bisection, not record-by-record:";
  const after =
    "Stock sets no keyset field, so it drains the whole company into one page that grows with " +
    "the catalog. syncCustomer / syncProduct already accept an arbitrary items[], so recursion " +
    "is a wrapper, not a restructure.Cannot live in ingestBatch — it receives an opaque closure " +
    "and never sees the items.";
  const haystack = before + after;
  const tableText = "domain schedule page size linear bisection customers (diff) 5 min ~12 12 ~4";
  const excerpt = `${before}\n${tableText}\n${after}`;

  it("spans the whole section, table included", () => {
    const span = findExcerptSpan(haystack, excerpt);
    expect(span).not.toBeNull();
    expect(span!.start).toBe(0);
    expect(span!.end).toBe(haystack.length); // start of the section through the end of it
  });

  it("still anchors when only the tail survives verbatim", () => {
    const span = findExcerptSpan(haystack, `${before}\n${tableText}\n${after.slice(0, 120)}`);
    expect(span!.start).toBe(0);
    expect(span!.end).toBeGreaterThan(before.length); // reached past the omitted table
  });

  it("refuses to anchor when the tail matches something far away", () => {
    // head is early, tail appears only in a much later passage — the span would be far longer than
    // the excerpt, which cannot happen for a real selection.
    const long = "A".repeat(50) + "x".repeat(4000) + "B".repeat(50);
    expect(findExcerptSpan(long, "A".repeat(50) + "B".repeat(50))).toBeNull();
  });

  it("does not anchor a short excerpt — too little text to be sure where it is", () => {
    expect(findExcerptSpan("alpha ... omega", "alpha omega")).toBeNull();
  });
});

// "make this smarter... to survive above any element so we don't get to this again."
// The root fix is structural, not another special case: ONE locator, and it reads every text node.
describe("one locator, no excluded elements", () => {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
  const PANELS = [
    "components/plan/annotation-panel.tsx",
    "components/learn/lesson-narrative-panel.tsx",
  ];

  it("both highlight surfaces call the shared locator instead of copying it", () => {
    for (const p of PANELS) {
      const src = read(p);
      expect(src).toContain('from "@/lib/excerpt-match"');
      expect(src).toContain("findExcerptRange(");
      // The private copies are gone — they were byte-identical, so every bug had to be found twice.
      expect(src).not.toContain("function findFirstTextRange");
      expect(src).not.toContain("createTreeWalker");
    }
  });

  it("walks EVERY text node — nothing a user can select is unsearchable", () => {
    const src = read("lib/excerpt-match.ts");
    expect(src).toContain("createTreeWalker(root, NodeFilter.SHOW_TEXT)");
    // No acceptNode filter at all: excluding `pre`/`table` is what broke selections over a table.
    expect(src).not.toContain("FILTER_REJECT");
    expect(src).not.toContain("pre, table");
  });
});
