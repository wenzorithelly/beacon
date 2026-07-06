"use client";

import { useEffect, useReducer, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { cn } from "@/lib/utils";

// Shared Tiptap toolbar primitives used by every editor toolbar (the notes drawer + the node
// editor). One definition instead of a copy per surface.

/** Re-render the caller on every editor transaction so `isActive()` highlights stay current. */
export function useEditorTick(editor: Editor): void {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const update = () => force();
    editor.on("transaction", update);
    return () => void editor.off("transaction", update);
  }, [editor]);
}

/** A formatting toggle button. `onMouseDown` preventDefault keeps the editor selection; the
 *  nodrag/nopan classes are no-ops off-canvas and stop a React Flow drag when on it. */
export function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "nodrag nopan rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground",
        active && "bg-[var(--ink-active)] text-foreground",
      )}
    >
      {children}
    </button>
  );
}
