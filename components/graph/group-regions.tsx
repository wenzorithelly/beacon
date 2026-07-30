"use client";

import { ViewportPortal, useStore } from "@xyflow/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { categoryRegionClass } from "@/lib/category-color";
import type { Region } from "@/lib/group-regions";
import type { Lod } from "@/lib/zoom-lod";
import { cn } from "@/lib/utils";

// Labeled "common region" containers behind each group of cards — the strongest preattentive
// grouping signal (Gestalt): N scattered cards read as a handful of labeled chunks. Rendered in
// flow coordinate space (ViewportPortal) so they pan/zoom with the canvas; non-interactive and
// at zIndex 0 so cards and edges always sit on top. Must be a child of <ReactFlow>.
//
// tone="category" colors each region by its key through the same palette as the category badges
// (double-encoding the grouping); "neutral" keeps the quiet white boxes (status/priority lanes,
// where hashing the label would imply a meaning the color doesn't have).
//
// At far zoom (lod="far") the cards inside are invisible specks, so each region flips to an
// OPAQUE summary block — group name + count at display size. Zoomed out you read structure.
//
// The lane-density props (collapsed / onToggleCollapse / hideEmpty) are all OPTIONAL and
// PRESENTATIONAL — state and callbacks come from the board. Omit them and this renders exactly
// what it always did.

/** Flow-space height of a lane rendered collapsed: the header strip, nothing else. */
const COLLAPSED_H = 34;

export function GroupRegions({
  regions,
  tone = "neutral",
  lod = "full",
  collapsed,
  onToggleCollapse,
  hideEmpty = false,
}: {
  regions: Region[];
  tone?: "category" | "neutral";
  lod?: Lod;
  /** Lane keys to render as a compact summary strip instead of a full box. The CARDS inside are
   *  the board's business — this only collapses the container. */
  collapsed?: ReadonlySet<string>;
  /** Absent → no collapse control is rendered at all. */
  onToggleCollapse?: (key: string, next: boolean) => void;
  /** Drop lanes with no cards left in them instead of drawing an empty box. */
  hideEmpty?: boolean;
}) {
  // Counter-scale the far-zoom summary text so it reads at a constant SCREEN size — the flow
  // space shrinks with zoom, the words shouldn't. (Subscribing to zoom only matters while the
  // user is actively zooming; the component is tiny.)
  const zoom = useStore((s) => s.transform[2]);
  const shown = hideEmpty ? regions.filter((r) => r.count > 0) : regions;
  if (shown.length === 0) return null;
  const labelPx = Math.min(150, 26 / Math.max(zoom, 0.05));
  const countPx = Math.min(80, 13 / Math.max(zoom, 0.05));
  return (
    <ViewportPortal>
      {shown.map((r) => {
        const isCollapsed = collapsed?.has(r.key) ?? false;
        // Collapsed wins over the far-zoom summary: there's nothing inside left to summarize.
        const far = lod === "far" && !isCollapsed;
        return (
          <div
            key={r.key}
            style={{
              position: "absolute",
              transform: `translate(${r.x}px, ${r.y}px)`,
              width: r.w,
              height: isCollapsed ? COLLAPSED_H : r.h,
              pointerEvents: "none",
              zIndex: 0,
            }}
            className={cn(
              "rounded-2xl border",
              tone === "category" ? categoryRegionClass(r.key) : "border-border bg-[var(--ink-hover)]",
              (far || isCollapsed) && "bg-card/80",
            )}
          >
            {far ? (
              <div className="flex h-full flex-col items-center justify-center gap-[0.3em] px-2">
                <span
                  className="whitespace-nowrap text-center font-semibold tracking-tight text-foreground"
                  // Screen-constant size, but never bigger than the region can hold — the WHOLE
                  // word always shows (the font shrinks to fit; never an ellipsis).
                  style={{
                    fontSize: Math.min(labelPx, r.h * 0.34, (r.w - 16) / (Math.max(r.label.length, 1) * 0.74)),
                    lineHeight: 1.1,
                  }}
                >
                  {r.label}
                </span>
                <span
                  className="tabular-nums text-muted-foreground"
                  style={{ fontSize: Math.min(countPx, r.h * 0.18) }}
                >
                  {r.count} {r.count === 1 ? "card" : "cards"}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                  {r.label}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground/50">{r.count}</span>
                {isCollapsed && (
                  <span className="text-[10px] text-muted-foreground/50">collapsed</span>
                )}
                {onToggleCollapse && (
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${r.label} lane`}
                    onClick={() => onToggleCollapse(r.key, !isCollapsed)}
                    style={{ pointerEvents: "auto" }}
                    className="ml-auto grid size-5 place-items-center rounded text-muted-foreground/60 hover:bg-[var(--ink-hover)] hover:text-foreground"
                  >
                    {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </ViewportPortal>
  );
}
