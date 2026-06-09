import { describe, expect, it } from "bun:test";
import { renderFeedback, type TextAnnotation } from "@/lib/annotations";

describe("renderFeedback (text-range comments → markdown for Claude)", () => {
  it("emits a `>` quote of the excerpt followed by the user's comment", () => {
    const a: TextAnnotation[] = [
      { excerpt: "crawl_sources", comment: "rename to court_crawler" },
    ];
    const txt = renderFeedback(a);
    expect(txt).toContain("> crawl_sources");
    expect(txt).toContain("rename to court_crawler");
  });

  it("preserves order and separates multiple annotations", () => {
    const a: TextAnnotation[] = [
      { excerpt: "first thing", comment: "looks good" },
      { excerpt: "second thing", comment: "not so good" },
    ];
    const txt = renderFeedback(a);
    const i1 = txt.indexOf("first thing");
    const i2 = txt.indexOf("second thing");
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(txt).toContain("looks good");
    expect(txt).toContain("not so good");
  });

  it("quotes multi-line excerpts line by line so the markdown stays valid", () => {
    const a: TextAnnotation[] = [
      { excerpt: "line one\nline two", comment: "drop line two" },
    ];
    const txt = renderFeedback(a);
    expect(txt).toMatch(/^> line one$/m);
    expect(txt).toMatch(/^> line two$/m);
  });

  it("returns an empty string when nothing was annotated", () => {
    expect(renderFeedback([])).toBe("");
  });

  it("ignores annotations whose comment is blank — those add no signal", () => {
    const a: TextAnnotation[] = [
      { excerpt: "x", comment: "  " },
      { excerpt: "y", comment: "real comment" },
    ];
    const txt = renderFeedback(a);
    expect(txt).not.toContain("> x");
    expect(txt).toContain("> y");
    expect(txt).toContain("real comment");
  });

  it("includes a global comment section when provided", () => {
    const txt = renderFeedback([], "Reshape this entirely");
    expect(txt).toContain("Overall feedback");
    expect(txt).toContain("Reshape this entirely");
  });

  it("combines both sections when global comment AND inline comments are present", () => {
    const a: TextAnnotation[] = [{ excerpt: "x", comment: "fix x" }];
    const txt = renderFeedback(a, "general thoughts");
    expect(txt).toContain("Overall feedback");
    expect(txt).toContain("general thoughts");
    expect(txt).toContain("Inline comments");
    expect(txt).toContain("> x");
    expect(txt).toContain("fix x");
  });
});
