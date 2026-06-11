"use client";

import { LAYER_META, LAYERS, layerStripeCss, type Layer } from "@/lib/layer";
import { cn } from "@/lib/utils";

/** Which layers stay BRIGHT when a pill is active. FE/BE keep fullstack bright too —
 *  fullstack work lands on that side as well; the FS pill isolates fullstack alone.
 *  Cards/files with no layer always dim while any pill is on. */
export function layerEmphasisMatch(emphasis: Layer, layer: Layer | null): boolean {
  if (!layer) return false;
  if (emphasis === "fullstack") return layer === "fullstack";
  return layer === emphasis || layer === "fullstack";
}

// Layer emphasis pills — one per layer, carrying the stripe color swatch, so the control
// doubles as the legend. Single-select; clicking the active pill clears it. Selecting one
// DIMS non-matching nodes instead of hiding them: the canvas keeps its shape (no "where
// did my card go"), the layer just comes forward.
export function LayerToggle({
  value,
  onChange,
  options = LAYERS,
}: {
  value: Layer | null;
  onChange: (next: Layer | null) => void;
  /** Which pills to render. The FILES canvas passes only frontend+backend — a FILE is never
   *  "fullstack"; one imported by both sides is shared, and both pills keep it bright. */
  options?: readonly Layer[];
}) {
  return (
    <div className="glass flex items-center gap-0.5 rounded-lg p-0.5">
      {options.map((l) => {
        const on = value === l;
        return (
          <button
            key={l}
            type="button"
            onClick={() => onChange(on ? null : l)}
            title={
              on
                ? "Show every layer at full strength again"
                : `Highlight ${LAYER_META[l].label} — other cards dim, nothing is hidden`
            }
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] font-semibold uppercase tracking-wide transition-colors",
              on
                ? "bg-white/[0.12] text-foreground"
                : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
            )}
          >
            <span
              aria-hidden
              className="h-3 w-[3px] shrink-0 rounded-full"
              style={{ background: layerStripeCss(l) }}
            />
            {LAYER_META[l].short}
          </button>
        );
      })}
    </div>
  );
}
