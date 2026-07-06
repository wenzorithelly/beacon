"use client";

import { ViewportPortal, useStore } from "@xyflow/react";
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
export function GroupRegions({
  regions,
  tone = "neutral",
  lod = "full",
}: {
  regions: Region[];
  tone?: "category" | "neutral";
  lod?: Lod;
}) {
  // Counter-scale the far-zoom summary text so it reads at a constant SCREEN size — the flow
  // space shrinks with zoom, the words shouldn't. (Subscribing to zoom only matters while the
  // user is actively zooming; the component is tiny.)
  const zoom = useStore((s) => s.transform[2]);
  if (regions.length === 0) return null;
  const far = lod === "far";
  const labelPx = Math.min(150, 26 / Math.max(zoom, 0.05));
  const countPx = Math.min(80, 13 / Math.max(zoom, 0.05));
  return (
    <ViewportPortal>
      {regions.map((r) => (
        <div
          key={r.key}
          style={{
            position: "absolute",
            transform: `translate(${r.x}px, ${r.y}px)`,
            width: r.w,
            height: r.h,
            pointerEvents: "none",
            zIndex: 0,
          }}
          className={cn(
            "rounded-2xl border",
            tone === "category" ? categoryRegionClass(r.key) : "border-border bg-[var(--ink-hover)]",
            far && "bg-card/80",
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
            <div className="flex items-baseline gap-2 px-3 py-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                {r.label}
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground/50">{r.count}</span>
            </div>
          )}
        </div>
      ))}
    </ViewportPortal>
  );
}
