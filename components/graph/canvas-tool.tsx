"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SelectionMode } from "@xyflow/react";
import { Hand, MousePointer2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Desktop-app style cursor tool for every canvas. "pan" (the hand) grabs and drags the board;
// "select" (the pointer) rubber-band-selects nodes on an empty-canvas drag and moves the whole
// selection together. Default is "pan" so the existing drag-to-pan muscle memory is preserved.

export type CanvasTool = "pan" | "select";

interface CanvasToolFlowProps {
  panOnDrag: boolean | number[];
  selectionOnDrag: boolean;
  selectionMode: SelectionMode;
  selectNodesOnDrag: boolean;
}

export function useCanvasTool(initial: CanvasTool = "pan") {
  const [tool, setTool] = useState<CanvasTool>(initial);

  // V = select (pointer), H = hand (pan) — the Figma/desktop convention. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === "v" || e.key === "V") setTool("select");
      else if (e.key === "h" || e.key === "H") setTool("pan");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const flowProps: CanvasToolFlowProps =
    tool === "pan"
      ? {
          panOnDrag: true,
          selectionOnDrag: false,
          selectionMode: SelectionMode.Partial,
          selectNodesOnDrag: false,
        }
      : {
          // Left-drag rubber-bands a selection; middle / right mouse still pans the board.
          panOnDrag: [1, 2],
          selectionOnDrag: true,
          selectionMode: SelectionMode.Partial,
          selectNodesOnDrag: false,
        };

  return { tool, setTool, flowProps, paneClass: tool === "select" ? "rf-tool-select" : undefined };
}

export function CanvasToolToggle({
  tool,
  onChange,
}: {
  tool: CanvasTool;
  onChange: (t: CanvasTool) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-xl border border-white/15 bg-[#202024]/95 p-1 shadow-lg backdrop-blur">
      <ToolBtn
        active={tool === "select"}
        label="Select tool (V) — drag to box-select; move many nodes at once"
        onClick={() => onChange("select")}
      >
        <MousePointer2 className="size-4" />
      </ToolBtn>
      <ToolBtn
        active={tool === "pan"}
        label="Hand tool (H) — drag to pan the board"
        onClick={() => onChange("pan")}
      >
        <Hand className="size-4" />
      </ToolBtn>
    </div>
  );
}

function ToolBtn({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-lg transition-colors",
        active
          ? "bg-[#ff7a45]/15 text-[#ff7a45]"
          : "text-muted-foreground hover:bg-white/8 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
