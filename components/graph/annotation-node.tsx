"use client";

import { useEffect, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Canvas annotations: a numbered orange pin sits on the annotated table row / card and an
// orange curve drops to this "ANNOTATION · YOU" card. One accent (#ff7a45) on dark glass —
// the pin + card are review chrome, so they deliberately outshine the muted board nodes.
// Two modes share the look: on /plan the card mirrors a feedback comment (read-only here,
// edited in the Comments panel); on /map it's a persistent board annotation, edited in place.

export const ANNOTATION_ACCENT = "#ff7a45";

export type AnnotationNodeData = {
  n: number;
  text: string;
  annotationId: string;
  onClick?: (annotationId: string) => void;
  /** Persisted board-annotation mode (/map): type straight into the card; save on blur. */
  editable?: boolean;
  onChangeText?: (annotationId: string, body: string) => void;
  onDelete?: (annotationId: string) => void;
};

export type AnnotationFlowNode = Node<AnnotationNodeData>;

export function AnnotationCardNode({ data, selected }: NodeProps<AnnotationFlowNode>) {
  const [body, setBody] = useState(data.text);
  // Re-seed when another surface (live refresh, undo) changes the text under us.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBody(data.text);
  }, [data.text]);
  return (
    <div
      onClick={() => data.onClick?.(data.annotationId)}
      className={cn(
        "group/anno relative w-[270px] rounded-xl border border-white/10 bg-[#1b1b1e]/95 px-4 py-3 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur transition-colors hover:border-white/20",
        !data.editable && "cursor-pointer",
        selected && "border-[#ff7a45]/50",
      )}
    >
      {/* the orange bracket hugging the left edge */}
      <span
        aria-hidden
        className="pointer-events-none absolute -left-px bottom-2 top-2 w-[3px] rounded-full"
        style={{ background: ANNOTATION_ACCENT }}
      />
      {/* invisible target the pin's curve lands on (top-right, like the mock) */}
      <Handle
        type="target"
        id="in"
        position={Position.Top}
        isConnectable={false}
        className="!pointer-events-none !size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent"
        style={{ left: "auto", right: 22, top: 0 }}
      />
      <div className="flex items-center justify-between">
        <div
          className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em]"
          style={{ color: ANNOTATION_ACCENT }}
        >
          Annotation · You
        </div>
        {data.editable && data.onDelete && (
          <button
            type="button"
            title="Delete annotation"
            onClick={(e) => {
              e.stopPropagation();
              data.onDelete?.(data.annotationId);
            }}
            className="nodrag nopan -mr-1 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:text-red-300 group-hover/anno:opacity-100"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      {data.editable ? (
        <textarea
          value={body}
          autoFocus={!data.text.trim()}
          placeholder="Type your annotation…"
          rows={Math.max(2, Math.min(6, body.split("\n").length))}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => {
            if (body !== data.text) data.onChangeText?.(data.annotationId, body);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className="nodrag nopan mt-1.5 w-full resize-none bg-transparent text-[13px] leading-snug text-foreground/95 outline-none placeholder:text-muted-foreground/60"
        />
      ) : (
        <div className="mt-1.5 text-[13px] leading-snug text-foreground/95">
          {data.text.trim() ? data.text : <span className="text-muted-foreground">…</span>}
        </div>
      )}
    </div>
  );
}

/** Serializable board-annotation row passed from /map pages into the canvases. */
export interface BoardAnnotationPayload {
  id: string;
  targetKind: "feature" | "table" | "column" | "endpoint";
  targetId: string;
  columnName: string | null;
  body: string;
  x: number | null;
  y: number | null;
}

/** The numbered orange badge. Carries the source handle the annotation edge starts from. */
export function AnnotationPin({
  n,
  annotationId,
  onClick,
}: {
  n: number;
  annotationId: string;
  onClick?: (annotationId: string) => void;
}) {
  return (
    <button
      type="button"
      title={`Annotation ${n} — view comment`}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(annotationId);
      }}
      className="nodrag nopan relative flex size-6 items-center justify-center rounded-full font-mono text-[11px] font-bold text-[#181818] shadow-[0_0_0_3px_rgba(255,122,69,0.22),0_0_16px_2px_rgba(255,122,69,0.4)] transition-transform hover:scale-110"
      style={{ background: ANNOTATION_ACCENT }}
    >
      {n}
      <Handle
        type="source"
        id={`pin-${annotationId}`}
        position={Position.Bottom}
        isConnectable={false}
        className="!pointer-events-none !size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent"
        style={{ left: "50%", bottom: 2 }}
      />
    </button>
  );
}

/** Pins lined up at a row/header's right edge (rare >1: they fan left). */
export function PinRail({
  pins,
  onPinClick,
}: {
  pins: { id: string; n: number }[];
  onPinClick?: (annotationId: string) => void;
}) {
  if (!pins.length) return null;
  return (
    <span className="absolute -right-3 top-1/2 z-10 flex -translate-y-1/2 flex-row-reverse gap-1">
      {pins.map((p) => (
        <AnnotationPin key={p.id} n={p.n} annotationId={p.id} onClick={onPinClick} />
      ))}
    </span>
  );
}
