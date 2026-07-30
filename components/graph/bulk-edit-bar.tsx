"use client";

import { useStore } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import { PRIORITY_LABELS } from "@/lib/board-grouping";
import { STATUS_META } from "@/lib/constants";
import { LAYERS, LAYER_META, normalizeLayer } from "@/lib/layer";
import { cn } from "@/lib/utils";

// Multi-select action bar: with 2+ cards rubber-band-selected (the V tool), this floats just
// above the selection and writes ONE field across all of them.
//
// It is deliberately dumb about persistence — every control calls `onField`, which the board
// routes through its single saveFields path (optimistic + awaited + rolled back + undoable).
// This component never fetches.
//
// MIXED SELECTIONS follow tldraw's rule: a control shows a value only when EVERY selected card
// shares it; otherwise it renders blank ("Mixed") and picking an option writes that value to all.

/** The slice of a card the bar reads. MapNodeData satisfies it. */
export interface BulkEditNode {
  id: string;
  status: string;
  priority: number;
  cluster: string | null;
  layer: string | null;
}

/**
 * The one value every selected card shares, or `undefined` when they disagree (= mixed).
 * Pure — see tests/bulk-edit.test.ts.
 */
export function sharedValue<T, V>(items: readonly T[], read: (t: T) => V): V | undefined {
  if (!items.length) return undefined;
  const first = read(items[0]);
  return items.every((t) => Object.is(read(t), first)) ? first : undefined;
}

const MIXED = "__mixed__";
const NONE = "__none__";

export function BulkEditBar({
  nodes,
  anchor,
  statuses,
  categories,
  hasFrontend = false,
  onField,
  onDelete,
}: {
  /** The selected cards. The bar renders nothing below 2 — one card has the detail panel. */
  nodes: BulkEditNode[];
  /** Flow coordinates of the selection's top-center; the bar hangs just above it. */
  anchor: { x: number; y: number };
  statuses: readonly string[];
  categories: readonly string[];
  hasFrontend?: boolean;
  onField: (field: "status" | "priority" | "cluster" | "layer", value: string | number | null) => void;
  onDelete: () => void;
}) {
  // Counter-scale so the bar keeps a constant SCREEN size while living in flow space (same
  // trick the far-zoom region labels use) — it stays glued to the selection through pan/zoom.
  const zoom = useStore((s) => s.transform[2]);
  if (nodes.length < 2) return null;

  const status = sharedValue(nodes, (n) => n.status);
  const priority = sharedValue(nodes, (n) => n.priority);
  const cluster = sharedValue(nodes, (n) => n.cluster ?? "");
  const layer = sharedValue(nodes, (n) => normalizeLayer(n.layer) ?? "");

  return (
    <div
      // `nopan` keeps a drag on the bar from panning the board. Clicks never reach React Flow's
      // pane handler (it ignores anything whose target isn't the pane itself), so the selection
      // survives every interaction here.
      className="nopan absolute"
      style={{
        left: anchor.x,
        top: anchor.y,
        // Bottom-center pinned to the anchor at ANY zoom: the box is first moved so its
        // bottom-center sits on (left, top), then scaled about that same point.
        transform: `translate(-50%, calc(-100% - 10px)) scale(${1 / Math.max(zoom, 0.05)})`,
        transformOrigin: "bottom center",
        pointerEvents: "auto",
        zIndex: 40,
      }}
      role="toolbar"
      aria-label={`${nodes.length} cards selected`}
    >
      <div className="glass flex items-center gap-1 whitespace-nowrap rounded-xl p-1">
        <span className="px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
          {nodes.length} selected
        </span>
        <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />

        <Field
          label="Status"
          value={status ?? MIXED}
          onChange={(v) => onField("status", v)}
          options={statuses.map((s) => ({ value: s, label: STATUS_META[s]?.label ?? s }))}
          mixed={status === undefined}
        />
        <Field
          label="Priority"
          value={priority === undefined ? MIXED : String(priority)}
          onChange={(v) => onField("priority", Number(v))}
          options={PRIORITY_LABELS.map((l, p) => ({ value: String(p), label: l }))}
          mixed={priority === undefined}
        />
        <Field
          label="Category"
          value={cluster === undefined ? MIXED : cluster || NONE}
          onChange={(v) => onField("cluster", v === NONE ? null : v)}
          options={[
            { value: NONE, label: "No category" },
            ...categories.map((c) => ({ value: c, label: c })),
          ]}
          mixed={cluster === undefined}
        />
        {hasFrontend && (
          <Field
            label="Layer"
            value={layer === undefined ? MIXED : layer || NONE}
            onChange={(v) => onField("layer", v === NONE ? null : v)}
            options={[
              { value: NONE, label: "No layer" },
              ...LAYERS.map((l) => ({ value: l, label: LAYER_META[l].label })),
            ]}
            mixed={layer === undefined}
          />
        )}

        <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
        <button
          type="button"
          onClick={onDelete}
          title={`Delete ${nodes.length} cards`}
          aria-label={`Delete ${nodes.length} cards`}
          className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-500/15 hover:text-rose-400"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// A native <select> per dimension: the platform already gives it keyboard access, a scrollable
// popup and screen-reader semantics, so there is nothing here worth reinventing.
function Field({
  label,
  value,
  options,
  mixed,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  mixed: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={label}
      title={label}
      value={value}
      onChange={(e) => {
        if (e.target.value === MIXED) return;
        onChange(e.target.value);
      }}
      className={cn(
        "h-7 max-w-[8.5rem] rounded-lg border border-border bg-transparent px-1.5 text-[11px] outline-none transition-colors hover:bg-[var(--ink-hover)] focus:bg-[var(--ink-active)]",
        mixed ? "text-muted-foreground/60" : "text-foreground",
      )}
    >
      {/* Mixed selections show no value at all until one is picked — never a lie about
          what the cards actually hold. */}
      {mixed && (
        <option value={MIXED} className="bg-card">
          {label} · mixed
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-card">
          {o.label}
        </option>
      ))}
    </select>
  );
}
