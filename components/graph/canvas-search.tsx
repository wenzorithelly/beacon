"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CanvasPopover } from "./canvas-popover";
import { isTypingTarget } from "./use-board-keys";
import type { SearchHit } from "@/lib/canvas-search";

// Shared search popover for every canvas tab. Presentational only: the matching + ranking
// lives in lib/canvas-search.ts and the spotlight (dimming non-matches) is wired per-canvas.
// Typing drives the live spotlight on the canvas behind the popover; Enter zooms to all
// matches; clicking a row flies to that node. Closing the popover clears the query so the
// spotlight is never left dimming the canvas with no visible search box.

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
  const [open, setOpen] = useState(false);

  const close = () => {
    setOpen(false);
    onQuery(""); // closing releases the spotlight + empties the box
  };

  // "/" or ⌘F opens the search. This used to open on ANY printable key and preventDefault it,
  // which swallowed every single-key board shortcut (j k s p c l \ ?) — both listeners are on
  // `window`, so each letter fired the board action AND opened search seeded with that letter.
  // Two explicit keys, no seeding: the box opens empty and focused (autoFocus on the input).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open) return; // already searching — let the focused input handle keys
      if (e.altKey) return;
      const findChord = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f";
      if (!findChord && (e.key !== "/" || e.metaKey || e.ctrlKey)) return;
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
      e.preventDefault(); // "/" must not reach the page; ⌘F must not open the browser's find bar
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <CanvasPopover
      title="Search"
      open={open}
      onOpenChange={(o) => (o ? setOpen(true) : close())}
      // First board click pans/inspects the highlighted matches; a second (within ~1.5s)
      // dismisses — so you can scroll around to see what matched without losing the search.
      outsideClicksToClose={2}
      trigger={(open, toggle) => (
        <button
          type="button"
          onClick={toggle}
          title="Search this canvas (/)"
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
      <div className="relative">
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
          className="w-full rounded-md border border-border bg-[var(--ink-hover)] py-1 pl-2 pr-7 text-[12px] outline-none placeholder:text-muted-foreground/50 focus:bg-[var(--ink-active)]"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery("")}
            title="Clear search"
            className="absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
        {query.trim() && hits.length === 0 && (
          <div className="px-1 py-1 text-[11px] text-muted-foreground">No matches</div>
        )}
        {hits.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => {
              onPick(h.id);
              setOpen(false); // picking flies to the node + closes the search
            }}
            className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-[var(--ink-hover)]"
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
