import { describe, expect, it } from "bun:test";
import {
  isTypingTarget,
  matchBoardKey,
  stepSelection,
  BOARD_KEY_HELP,
} from "@/components/graph/use-board-keys";

// The board keybindings are a pure predicate (event-ish → action) plus a pure selection
// walker, so the whole key contract is testable without a DOM. The hook itself is a thin
// listener around these two.

const el = (tagName: string, isContentEditable = false) =>
  ({ tagName, isContentEditable }) as unknown as EventTarget;

describe("isTypingTarget", () => {
  it("is true for text-entry elements and contentEditable surfaces", () => {
    expect(isTypingTarget(el("INPUT"))).toBe(true);
    expect(isTypingTarget(el("TEXTAREA"))).toBe(true);
    expect(isTypingTarget(el("SELECT"))).toBe(true);
    expect(isTypingTarget(el("DIV", true))).toBe(true);
  });

  it("is false for the canvas and for nothing at all", () => {
    expect(isTypingTarget(el("DIV"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({} as EventTarget)).toBe(false);
  });
});

describe("matchBoardKey", () => {
  it("maps the Linear-canonical single keys", () => {
    expect(matchBoardKey({ key: "j" })).toBe("next");
    expect(matchBoardKey({ key: "k" })).toBe("prev");
    expect(matchBoardKey({ key: "s" })).toBe("status");
    expect(matchBoardKey({ key: "p" })).toBe("priority");
    expect(matchBoardKey({ key: "c" })).toBe("create");
    expect(matchBoardKey({ key: "l" })).toBe("category");
    expect(matchBoardKey({ key: "\\" })).toBe("isolate");
    expect(matchBoardKey({ key: "?" })).toBe("help");
    expect(matchBoardKey({ key: "Escape" })).toBe("clear");
  });

  it("accepts the shifted letter form (caps lock / held shift)", () => {
    expect(matchBoardKey({ key: "S", shiftKey: true })).toBe("status");
    expect(matchBoardKey({ key: "J" })).toBe("next");
  });

  it("maps ⌘K and Ctrl-K to the palette", () => {
    expect(matchBoardKey({ key: "k", metaKey: true })).toBe("palette");
    expect(matchBoardKey({ key: "k", ctrlKey: true })).toBe("palette");
  });

  it("ignores every other modified key so browser/app shortcuts survive", () => {
    expect(matchBoardKey({ key: "s", metaKey: true })).toBeNull(); // save
    expect(matchBoardKey({ key: "p", ctrlKey: true })).toBeNull(); // print
    expect(matchBoardKey({ key: "j", altKey: true })).toBeNull();
  });

  it("ignores unclaimed keys", () => {
    expect(matchBoardKey({ key: "z" })).toBeNull();
    expect(matchBoardKey({ key: "Enter" })).toBeNull();
    expect(matchBoardKey({ key: " " })).toBeNull();
  });

  it("never fires while the user is typing — including Escape and ⌘K", () => {
    expect(matchBoardKey({ key: "j", target: el("INPUT") })).toBeNull();
    expect(matchBoardKey({ key: "Escape", target: el("TEXTAREA") })).toBeNull();
    expect(matchBoardKey({ key: "k", metaKey: true, target: el("DIV", true) })).toBeNull();
  });

  it("documents every key it claims", () => {
    const claimed = BOARD_KEY_HELP.map((h) => h.keys).join(" ");
    for (const k of ["j", "k", "s", "p", "c", "l", "\\", "?", "Esc"]) expect(claimed).toContain(k);
  });
});

describe("stepSelection", () => {
  const order = ["a", "b", "c"];

  it("walks forward and backward through the given order", () => {
    expect(stepSelection(order, "a", 1)).toBe("b");
    expect(stepSelection(order, "c", -1)).toBe("b");
  });

  it("starts at the first card going forward, the last going backward", () => {
    expect(stepSelection(order, null, 1)).toBe("a");
    expect(stepSelection(order, null, -1)).toBe("c");
    expect(stepSelection(order, "gone", 1)).toBe("a");
  });

  it("clamps at the ends instead of wrapping", () => {
    expect(stepSelection(order, "c", 1)).toBeNull();
    expect(stepSelection(order, "a", -1)).toBeNull();
  });

  it("does nothing on an empty board", () => {
    expect(stepSelection([], null, 1)).toBeNull();
    expect(stepSelection([], "a", -1)).toBeNull();
  });
});
