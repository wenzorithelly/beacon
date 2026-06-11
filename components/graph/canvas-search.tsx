"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { CanvasPopover } from "./canvas-popover";
import type { SearchHit } from "@/lib/canvas-search";

// Shared search popover for every canvas tab. Presentational only: the matching + ranking
// lives in lib/canvas-search.ts and the spotlight (dimming non-matches) is wired per-canvas.
// Typing drives the live spotlight on the canvas behind the popover; Enter zooms to all
// matches; clicking a row flies to that node.

export function CanvasSearch({
  query,
  onQuery,
  hits,
  onPick,
  onZoomToMatches,
  placeholder = "Search…",
}: {
  query: string;
  onQuery: (q: string) => void;
  hits: SearchHit[];
  onPick: (id: string) => void;
  onZoomToMatches?: () => void;
  placeholder?: string;
}) {
  return (
    <CanvasPopover
      title="Search"
      trigger={(open, toggle) => (
        <button
          type="button"
          onClick={toggle}
          title="Search this canvas"
          className={cn(
            "glass flex size-8 items-center justify-center rounded-lg transition-colors",
            open || query.trim()
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Search className="size-4" />
        </button>
      )}
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onZoomToMatches) {
            e.preventDefault();
            onZoomToMatches();
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[12px] outline-none placeholder:text-muted-foreground/50 focus:bg-white/[0.08]"
      />
      <div className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
        {query.trim() && hits.length === 0 && (
          <div className="px-1 py-1 text-[11px] text-muted-foreground">No matches</div>
        )}
        {hits.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => onPick(h.id)}
            className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-white/5"
          >
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground transition-colors group-hover:text-foreground">
              {h.label}
            </span>
            {h.sublabel && (
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/50">
                {h.sublabel}
              </span>
            )}
          </button>
        ))}
      </div>
    </CanvasPopover>
  );
}
