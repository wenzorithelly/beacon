"use client";

import { useEffect } from "react";

// Single-key board shortcuts (the Linear set). The matching is a pure predicate and the
// selection walk is a pure function, so the whole contract is testable without a DOM; the
// hook is just a window listener around them.
//
// KEYS CLAIMED BY THIS HOOK — j k s p c l \ ? Escape, plus ⌘K/Ctrl-K.
// `components/graph/canvas-search.tsx` currently opens the search popover on ANY printable
// key, so every letter here also opens search until that handler is narrowed (see the note
// in the integration report: search should move to "/" or ⌘F).

export type BoardKeyAction =
  | "next"
  | "prev"
  | "status"
  | "priority"
  | "create"
  | "category"
  | "isolate"
  | "help"
  | "palette"
  | "clear";

/** Keys → what they do, for the "?" help sheet and so tests can assert nothing is undocumented.
 *  ⌘Z/⌘⇧Z belong to use-undo, not to this hook — they are listed because the help sheet is the
 *  board's ONLY keyboard reference, and an undocumented undo may as well not exist. */
export const BOARD_KEY_HELP: { keys: string; label: string }[] = [
  { keys: "j / k", label: "Next / previous card" },
  { keys: "s", label: "Set status" },
  { keys: "p", label: "Set priority" },
  { keys: "l", label: "Set category" },
  { keys: "c", label: "New card" },
  { keys: "\\", label: "Isolate dependencies" },
  { keys: "⌘Z", label: "Undo" },
  { keys: "⌘⇧Z", label: "Redo" },
  { keys: "⌘K", label: "Command palette" },
  { keys: "?", label: "This help" },
  { keys: "Esc", label: "Clear selection" },
];

const LETTER_ACTIONS: Record<string, BoardKeyAction> = {
  j: "next",
  k: "prev",
  s: "status",
  p: "priority",
  c: "create",
  l: "category",
};

/**
 * True when the user is typing somewhere we must not hijack (an input, textarea, select, or
 * any contentEditable surface like the Notes editor). Same guard as canvas-tool.tsx:27-29 /
 * canvas-search.tsx:17-22 — exported here so those two can drop their private copies.
 */
export function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || !node.tagName) return false;
  return (
    node.tagName === "INPUT" ||
    node.tagName === "TEXTAREA" ||
    node.tagName === "SELECT" ||
    node.isContentEditable
  );
}

/** The fields of a KeyboardEvent this predicate reads — a real event satisfies it. */
export interface BoardKeyEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: EventTarget | null;
  /** Already claimed by something layered over the board. */
  defaultPrevented?: boolean;
}

/**
 * Which board action (if any) a keystroke means. Null while typing, for unclaimed keys, and for
 * an event something INNER already claimed.
 *
 * `defaultPrevented` is the repo-wide stand-down signal (node-card's card-Escape reads it too):
 * these bindings are the OUTERMOST keyboard layer, so anything nearer the user — a popover
 * closing on Escape, the focus modal committing — claims the key first and this yields. Without
 * it, one Escape closed the Filters popover AND cleared the selection AND dropped the isolate
 * lens, because both listeners sit on `window` and neither knew about the other.
 */
export function matchBoardKey(e: BoardKeyEvent): BoardKeyAction | null {
  if (e.defaultPrevented) return null;
  if (isTypingTarget(e.target ?? null)) return null;
  if (e.metaKey || e.ctrlKey) return e.key.toLowerCase() === "k" && !e.altKey ? "palette" : null;
  if (e.altKey) return null;
  if (e.key === "Escape") return "clear";
  if (e.key === "?") return "help";
  if (e.key === "\\") return "isolate";
  return LETTER_ACTIONS[e.key.toLowerCase()] ?? null;
}

/**
 * The id `delta` steps from `selectedId` in `orderedIds`, or null when there is nowhere to
 * go. No selection starts at the first card (forward) or the last (backward); the ends clamp
 * rather than wrap, so holding j never loops the board.
 */
export function stepSelection(
  orderedIds: string[],
  selectedId: string | null,
  delta: 1 | -1,
): string | null {
  if (!orderedIds.length) return null;
  const at = selectedId ? orderedIds.indexOf(selectedId) : -1;
  if (at === -1) return delta === 1 ? orderedIds[0] : orderedIds[orderedIds.length - 1];
  const next = at + delta;
  return next >= 0 && next < orderedIds.length ? orderedIds[next] : null;
}

export interface BoardKeysOptions {
  /**
   * Pass false whenever something else owns the keyboard — the command palette, the focus
   * modal, the guided tour, any open dialog — or whenever THIS board is not the one on screen
   * (the /map shell keeps hidden tabs mounted, and a hidden board must not answer keys).
   * Defaults to true.
   */
  enabled?: boolean;
  /**
   * Card ids in the order the board displays them (lane order, then position within the
   * lane). j/k walk this list — ordering stays the caller's business.
   */
  orderedIds: string[];
  selectedId: string | null;
  /** j / k — called with the id to select next. */
  onSelect: (id: string) => void;
  /** Handlers for the remaining keys. An unwired key is simply inert (the event isn't eaten). */
  onStatus?: () => void;
  onPriority?: () => void;
  onCategory?: () => void;
  onCreate?: () => void;
  onIsolate?: () => void;
  onHelp?: () => void;
  /** Omit when a <CommandPalette/> is mounted — it binds ⌘K itself. */
  onPalette?: () => void;
  onClear?: () => void;
}

export function useBoardKeys(opts: BoardKeysOptions): void {
  const {
    enabled = true,
    orderedIds,
    selectedId,
    onSelect,
    onStatus,
    onPriority,
    onCategory,
    onCreate,
    onIsolate,
    onHelp,
    onPalette,
    onClear,
  } = opts;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const action = matchBoardKey(e);
      if (!action) return;
      if (action === "next" || action === "prev") {
        const id = stepSelection(orderedIds, selectedId, action === "next" ? 1 : -1);
        if (!id) return;
        e.preventDefault();
        onSelect(id);
        return;
      }
      const handler = {
        status: onStatus,
        priority: onPriority,
        category: onCategory,
        create: onCreate,
        isolate: onIsolate,
        help: onHelp,
        palette: onPalette,
        clear: onClear,
      }[action];
      if (!handler) return; // unwired — leave the key to whoever else wants it
      e.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    enabled,
    orderedIds,
    selectedId,
    onSelect,
    onStatus,
    onPriority,
    onCategory,
    onCreate,
    onIsolate,
    onHelp,
    onPalette,
    onClear,
  ]);
}
