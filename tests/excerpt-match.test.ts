import { describe, expect, it } from "bun:test";
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
