"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UndoStack, type UndoEntry } from "@/lib/undo-stack";

export type { UndoEntry } from "@/lib/undo-stack";

export interface UseUndo {
  /** Record a mutation. Call it at the mutation site, with the inverse captured from the real
   *  pre-state you already have in hand — never reconstructed later. */
  push: (entry: UndoEntry) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

// A keystroke aimed at a text field belongs to that field: the browser's own undo already works
// there, and stealing ⌘Z mid-title-edit would revert the board instead of the word.
const TYPING = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

/**
 * Board undo/redo: the stack from lib/undo-stack plus ⌘Z / ⌘⇧Z (Ctrl on Windows, Ctrl+Y too).
 *
 * `enabled` is the single suppression lever — pass false while a dialog/modal owns the keyboard,
 * on read-only boards, or wherever the shortcut shouldn't fire. Typing inside a field is
 * suppressed unconditionally, whatever `enabled` says.
 */
export function useUndo(enabled: boolean): UseUndo {
  // Bump on every stack change so canUndo/labels re-render. The stack itself is stable.
  const [, bump] = useState(0);
  const stack = useMemo(() => new UndoStack({ onChange: () => bump((n) => n + 1) }), []);

  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const undo = useCallback(() => void stack.undo(), [stack]);
  const redo = useCallback(() => void stack.redo(), [stack]);
  const push = useCallback((e: UndoEntry) => stack.push(e), [stack]);
  const clear = useCallback(() => stack.clear(), [stack]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!enabledRef.current) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      const isUndo = k === "z" && !e.shiftKey;
      const isRedo = (k === "z" && e.shiftKey) || (e.ctrlKey && k === "y");
      if (!isUndo && !isRedo) return;
      if ((e.target as HTMLElement | null)?.closest?.(TYPING)) return;
      e.preventDefault(); // don't also fire the browser's document-level undo
      void (isRedo ? stack.redo() : stack.undo());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack]);

  return {
    push,
    undo,
    redo,
    clear,
    canUndo: stack.canUndo,
    canRedo: stack.canRedo,
    undoLabel: stack.undoLabel,
    redoLabel: stack.redoLabel,
  };
}
