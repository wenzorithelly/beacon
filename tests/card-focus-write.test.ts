import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Writing a description happens in ONE place: the focus modal. The board card shows the
// description read-only and hands off on click, so B/I/list controls stop polluting every
// expanded card — and in the modal the controls only appear over a real text selection.
// These are source-structure guards (same pattern as agent-copy.test.ts): the behaviour lives
// in JSX wiring, so the cheapest thing that fails when it regresses is asserting the wiring.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const card = read("components/graph/node-card.tsx");
const editor = read("components/graph/rich-node-editor.tsx");
const modal = read("components/graph/focus-editor-modal.tsx");

const expandBody = card.slice(card.indexOf("const descHint"), card.indexOf("// ── ARCHITECTURE"));

describe("the expanded card is read-only; writing hands off to the focus modal", () => {
  it("renders the description non-editable (which is what drops the toolbar + writing box)", () => {
    expect(expandBody).toContain("editable={false}");
    // the old always-editable inline editor is gone
    expect(card).not.toContain("editable={!readOnly}");
  });

  it("opens the focus modal on click, keyboard-reachable", () => {
    expect(expandBody).toContain("focusDescription");
    expect(expandBody).toContain('role="button"');
    expect(expandBody).toContain("tabIndex={0}");
    expect(expandBody).toContain('e.key === "Enter" || e.key === " "');
  });

  it("shows a click-to-write affordance (and doesn't promise writing on a read-only board)", () => {
    expect(expandBody).toContain('const descHint = readOnly ? "Open description" : "Click to write"');
    expect(expandBody).toContain("aria-label={descHint}");
    expect(expandBody).toContain("cursor-text");
    expect(expandBody).toContain("hover:border-border");
  });
});

// Owner ruling, reversing the earlier selection-bubble design: "this appearing only when i
// highlight is not good... not productive at all". The original "toolbar pollutes the card"
// complaint is answered structurally instead — cards render their description read-only, so an
// editable editor only exists while you are deliberately writing.
describe("formatting controls are a docked bar, shown only while editable", () => {
  it("does not use a selection bubble", () => {
    expect(editor).not.toContain("BubbleMenu");
  });

  it("docks the toolbar above the content, gated on editable", () => {
    expect(editor).toMatch(/\{editable && \([\s\S]{0,600}<Toolbar/);
    // Deliberately NOT sticky — a floating bar let scrolled prose show above and below it.
    // The prose scrolls in its own bounded box instead, so the bar stays put with nothing behind.
    expect(editor).not.toContain("sticky top-0");
    expect(editor).toContain('roomy && editable && "max-h-[52vh] overflow-y-auto"');
  });

  it("keeps the shared ToolbarButton (aria-label + aria-pressed come from it)", () => {
    expect(editor).toContain("ToolbarButton");
    const shared = read("components/editor/editor-toolbar.tsx");
    expect(shared).toContain("aria-label={label}");
    expect(shared).toContain("aria-pressed={active}");
  });
});

describe("icon-only card buttons carry an accessible name", () => {
  it("labels every icon-only control", () => {
    for (const label of [
      "Edit description in focus mode",
      // Not "…side panel": on /map the dock is retired and this opens the centered detail modal.
      "Open details",
      "Flag a bug on this component",
      "Accept suggestion — turn it into your own feature",
      "Dismiss suggestion (deletes the card)",
    ])
      expect(card).toContain(`aria-label="${label}"`);
    // dynamic names
    expect(card).toContain("aria-label={`Annotate ${data.title}`}");
    expect(card).toContain("aria-label={subtaskToggleLabel}");
    expect(card).toContain("aria-label={expanded ?");
  });

  it("marks the disclosure toggles with aria-expanded", () => {
    expect(card).toContain("aria-expanded={expanded}");
    expect(card).toContain("aria-expanded={!data.collapsed}");
  });
});

describe("Escape on the card", () => {
  const esc = card.slice(card.indexOf("const rootRef"), card.indexOf("// Blow the description up"));

  it("collapses an expanded card only when nothing is being edited", () => {
    expect(esc).toMatch(/expanded\s*\n?\s*\?/); // no listener at all while collapsed
    expect(esc).toContain("toggleExpand(id)");
    expect(esc).toMatch(/INPUT|TEXTAREA|isContentEditable/);
  });

  it("stands down once something layered over the board already handled the key", () => {
    // The focus modal's capture-phase listener commits + dismisses and preventDefaults, but does
    // NOT stopPropagation — the same keypress reaches this wrapper. On a READ-ONLY board the modal
    // isn't autofocused, so the target is the card's description DIV and the INPUT/TEXTAREA guard
    // misses it: without the defaultPrevented check one Escape closed the modal AND collapsed the
    // card under it.
    expect(esc).toContain("e.defaultPrevented");
    const onKey = modal.slice(modal.indexOf("const onKey"), modal.indexOf("document.addEventListener"));
    expect(onKey).toContain("e.preventDefault()");
    expect(onKey).not.toContain("stopPropagation"); // the assumption the guard rests on
  });

  it("listens on the React Flow node wrapper — the element that actually holds focus", () => {
    expect(esc).toMatch(/\.closest<[^>]+>\("\.react-flow__node"\)/);
    expect(esc).toContain('addEventListener("keydown", onCardEscape)');
    expect(esc).toContain('removeEventListener("keydown", onCardEscape)');
    // the ref is on both card shapes
    expect(card.match(/ref=\{rootRef\}/g)?.length).toBe(2);
  });

  it("reverts an in-progress title or category edit to the last committed value", () => {
    expect(card).toContain("escRevert.current = true");
    expect(card).toContain("setTitle(data.title)");
    expect(card).toContain('setCluster(data.cluster ?? "")');
  });
});

describe("the focus modal's existing close/autosave contract is untouched", () => {
  it("keeps Esc / ⌘↵ on a capture-phase document listener", () => {
    expect(modal).toContain('document.addEventListener("keydown", onKey, true)');
    expect(modal).toContain('e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === "Enter")');
  });

  it("keeps backdrop-click autosave", () => {
    expect(modal).toContain("if (e.target === e.currentTarget) commit();");
  });
});
