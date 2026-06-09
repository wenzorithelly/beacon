import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  splitBlocks,
  formatMaybeJson,
  Inline,
  TableBlock,
  type Block,
  isHeading,
  headingLevel,
  planHeadingAnchor,
  stripInline,
} from "@/components/plan/markdown-view";

describe("splitBlocks — fenced code blocks", () => {
  it("captures a fenced block verbatim and drops the fences", () => {
    const md = [
      "# Title",
      "",
      "Some prose.",
      "",
      "```json",
      '{ "a": 1,',
      '  "b": "x" }',
      "```",
      "",
      "After.",
    ].join("\n");
    const blocks = splitBlocks(md);

    const code = blocks.find((b) => b.kind === "code");
    expect(code?.text).toBe('{ "a": 1,\n  "b": "x" }');
    // No block still contains the ``` fence.
    expect(blocks.every((b) => !b.text.includes("```"))).toBe(true);
    // Surrounding prose survives as its own blocks.
    expect(blocks.some((b) => b.kind === "h1" && b.text === "Title")).toBe(true);
    expect(blocks.some((b) => b.kind === "p" && b.text === "After.")).toBe(true);
  });

  it("does not parse #/-/inline markers inside a code block", () => {
    const md = ["```ts", "# not a heading", "- not a list", "*not emphasis*", "```"].join("\n");
    const blocks = splitBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("code");
    expect(blocks[0].text).toBe("# not a heading\n- not a list\n*not emphasis*");
  });

  it("renders an unterminated fence as a code block rather than dropping it", () => {
    const md = ["```", "line one", "line two"].join("\n");
    const blocks = splitBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("code");
    expect(blocks[0].text).toBe("line one\nline two");
  });

  it("treats a bare ``` (no language) as a fence too", () => {
    const md = ["```", "x", "```"].join("\n");
    const blocks = splitBlocks(md);
    expect(blocks).toEqual([{ kind: "code", text: "x" }]);
  });
});

describe("splitBlocks — h4 headings", () => {
  it("parses #### as an h4 block", () => {
    expect(splitBlocks("#### Sub-sub")).toEqual([{ kind: "h4", text: "Sub-sub" }]);
  });

  it("keeps #/##/###/#### distinct — deeper hashes are not swallowed by shallower ones", () => {
    const blocks = splitBlocks(["# A", "## B", "### C", "#### D"].join("\n"));
    expect(blocks.map((b) => b.kind)).toEqual(["h1", "h2", "h3", "h4"]);
    expect(blocks.map((b) => b.text)).toEqual(["A", "B", "C", "D"]);
  });
});

describe("splitBlocks — ordered lists", () => {
  it("parses 1. / 2. as ol blocks carrying marker + text", () => {
    expect(splitBlocks(["1. first", "2. second"].join("\n"))).toEqual([
      { kind: "ol", text: "first", depth: 0, marker: "1" },
      { kind: "ol", text: "second", depth: 0, marker: "2" },
    ]);
  });

  it("does not mistake mid-sentence numbers for list markers", () => {
    const blocks = splitBlocks("In 2024 we shipped 3 things.");
    expect(blocks).toEqual([{ kind: "p", text: "In 2024 we shipped 3 things." }]);
  });
});

describe("splitBlocks — nested lists", () => {
  it("tracks indentation depth for nested bullets and numbers", () => {
    const md = ["- top", "  - nested", "    - deeper", "  1. n-ordered"].join("\n");
    expect(splitBlocks(md)).toEqual([
      { kind: "ul", text: "top", depth: 0 },
      { kind: "ul", text: "nested", depth: 1 },
      { kind: "ul", text: "deeper", depth: 2 },
      { kind: "ol", text: "n-ordered", depth: 1, marker: "1" },
    ]);
  });
});

describe("splitBlocks — blockquotes", () => {
  it("merges consecutive > lines into one quote block", () => {
    const md = ["> line one", "> line two", "", "after"].join("\n");
    expect(splitBlocks(md)).toEqual([
      { kind: "quote", text: "line one\nline two" },
      { kind: "p", text: "after" },
    ]);
  });

  it("handles > with no trailing space and bare > lines", () => {
    expect(splitBlocks([">quoted", ">", ">more"].join("\n"))).toEqual([
      { kind: "quote", text: "quoted\n\nmore" },
    ]);
  });

  it("closes a quote when a non-quote line follows, without merging into prose", () => {
    const blocks = splitBlocks(["text before", "> a quote", "text after"].join("\n"));
    expect(blocks).toEqual([
      { kind: "p", text: "text before" },
      { kind: "quote", text: "a quote" },
      { kind: "p", text: "text after" },
    ]);
  });
});

describe("splitBlocks — lazy continuation of wrapped list items", () => {
  it("joins a hard-wrapped list item into ONE block so spanning **bold** survives", () => {
    const md = [
      "1. **Diff Highlighting** — overlay on the **real",
      "architecture + DB maps** then done.",
    ].join("\n");
    expect(splitBlocks(md)).toEqual([
      {
        kind: "ol",
        text: "**Diff Highlighting** — overlay on the **real architecture + DB maps** then done.",
        depth: 0,
        marker: "1",
      },
    ]);
  });

  it("a blank line closes the item — following text is its own paragraph", () => {
    const md = ["- item one", "still item one", "", "separate paragraph"].join("\n");
    expect(splitBlocks(md)).toEqual([
      { kind: "ul", text: "item one still item one", depth: 0 },
      { kind: "p", text: "separate paragraph" },
    ]);
  });

  it("a following heading/list closes continuation (no accidental merge)", () => {
    const md = ["1. first", "## Section", "- a", "wrapped a"].join("\n");
    expect(splitBlocks(md)).toEqual([
      { kind: "ol", text: "first", depth: 0, marker: "1" },
      { kind: "h2", text: "Section" },
      { kind: "ul", text: "a wrapped a", depth: 0 },
    ]);
  });
});

describe("splitBlocks — GFM tables", () => {
  it("parses header + separator + body into ONE table block with parsed cells", () => {
    const md = ["| A | B |", "|---|---|", "| 1 | 2 |", "| 3 | 4 |"].join("\n");
    const blocks = splitBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("table");
    expect(blocks[0].rows).toEqual([
      ["A", "B"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("reads per-column alignment from the separator row", () => {
    const md = ["| L | C | R |", "|:--|:-:|--:|", "| a | b | c |"].join("\n");
    expect(splitBlocks(md)[0].align).toEqual(["left", "center", "right"]);
  });

  it("does NOT treat a lone pipe in prose as a table (no separator row follows)", () => {
    expect(splitBlocks("run a | b in the shell")).toEqual([
      { kind: "p", text: "run a | b in the shell" },
    ]);
  });

  it("does not mistake a --- horizontal rule for a table", () => {
    expect(splitBlocks(["text", "---", "more"].join("\n")).some((b) => b.kind === "table")).toBe(
      false,
    );
  });

  it("keeps prose before and after a table as their own blocks", () => {
    const md = ["intro", "", "| A | B |", "|---|---|", "| 1 | 2 |", "", "outro"].join("\n");
    expect(splitBlocks(md).map((b) => b.kind)).toEqual(["p", "table", "p"]);
  });
});

describe("TableBlock — render", () => {
  const html = (block: Block) => renderToStaticMarkup(createElement(TableBlock, { block }));

  it("renders a real <table> with header + body cells and inline markdown inside cells", () => {
    const block = splitBlocks(["| Name | Code |", "|---|---|", "| **bold** | `x` |"].join("\n"))[0];
    const out = html(block);
    expect(out).toContain("<table");
    expect(out).toContain("<th");
    expect(out).toContain("<td");
    expect(out).toContain("<strong"); // inline bold rendered in a header cell
    expect(out).toContain("<code"); // inline code rendered in a body cell
    expect(out).not.toContain("|"); // pipes are consumed, never shown as literal text
  });
});

describe("formatMaybeJson", () => {
  it("pretty-prints a crammed JSON one-liner into indented lines", () => {
    const out = formatMaybeJson('{ "a": 1, "b": { "c": [1,2] } }');
    expect(out).toBe('{\n  "a": 1,\n  "b": {\n    "c": [\n      1,\n      2\n    ]\n  }\n}');
  });

  it("returns null for non-JSON code (left verbatim)", () => {
    expect(formatMaybeJson("make migrate")).toBeNull();
    expect(formatMaybeJson("const x = 1;")).toBeNull();
    expect(formatMaybeJson("{ not valid json,,, }")).toBeNull();
    expect(formatMaybeJson("")).toBeNull();
  });
});

describe("section TOC helpers", () => {
  it("isHeading recognizes h1..h4 only", () => {
    expect((["h1", "h2", "h3", "h4"] as const).every(isHeading)).toBe(true);
    expect((["p", "ul", "ol", "quote", "code"] as const).some(isHeading)).toBe(false);
  });

  it("headingLevel maps h1..h4 → 0..3", () => {
    expect([headingLevel("h1"), headingLevel("h2"), headingLevel("h3"), headingLevel("h4")]).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it("planHeadingAnchor is stable and keyed on block index", () => {
    expect(planHeadingAnchor(0)).toBe("plan-h-0");
    expect(planHeadingAnchor(7)).toBe("plan-h-7");
  });

  it("stripInline removes bold/italic/code markers for clean TOC labels", () => {
    expect(stripInline("**Bold** and `code` and *em*")).toBe("Bold and code and em");
  });

  it("builds a TOC from heading blocks whose anchors match the rendered ids", () => {
    const md = ["# Title", "intro", "## Section A", "- x", "### Detail", "## Section B"].join("\n");
    const toc = splitBlocks(md)
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => isHeading(b.kind))
      .map(({ b, i }) => ({ id: planHeadingAnchor(i), level: headingLevel(b.kind), label: stripInline(b.text) }));
    expect(toc).toEqual([
      { id: "plan-h-0", level: 0, label: "Title" },
      { id: "plan-h-2", level: 1, label: "Section A" },
      { id: "plan-h-4", level: 2, label: "Detail" },
      { id: "plan-h-5", level: 1, label: "Section B" },
    ]);
  });
});

describe("Inline — bold / emphasis / code", () => {
  const html = (text: string) => renderToStaticMarkup(createElement(Inline, { text }));

  it("renders **bold** as <strong> with NO literal asterisks (the reported bug)", () => {
    const out = html("**Storage** — global");
    expect(out).toContain("<strong");
    expect(out).toContain("Storage");
    expect(out).not.toContain("*");
  });

  it("still renders *emphasis* and `inline code`", () => {
    const out = html("*emph* and `code`");
    expect(out).toContain("<em");
    expect(out).toContain("<code");
    expect(out).not.toContain("*");
    expect(out).not.toContain("`");
  });

  it("renders `code` nested inside **bold**", () => {
    const out = html("**Apply on `bin/plan.ts`**");
    expect(out).toContain("<strong");
    expect(out).toContain("<code");
    expect(out).not.toContain("*");
  });

  it("handles bold whose content contains a literal * (e.g. a /crawl/* glob)", () => {
    const out = html("**`/admin/crawl/*` is gated** — *any* user");
    expect(out).toContain("<strong");
    expect(out).toContain("<em");
    expect(out).toContain("/admin/crawl/*"); // the glob asterisk survives inside the code span
    // The only asterisk in the output is the glob's; no bold/emphasis delimiters leaked.
    expect(out.replace("/admin/crawl/*", "")).not.toContain("*");
  });
});
