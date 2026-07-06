"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Lightweight click-outside popover used for the canvas filter + legend buttons. We
// don't pull in shadcn's Popover (Radix Portal interferes with the React Flow z-stack
// and the click-outside math gets weird when the trigger lives inside a flow Panel).

export function CanvasPopover({
  trigger,
  title,
  align = "right",
  children,
  open: openProp,
  onOpenChange,
  outsideClicksToClose = 1,
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  title?: string;
  align?: "left" | "right";
  children: ReactNode;
  // Optional controlled mode (used by CanvasSearch for type-to-search). Omit both for the
  // default self-managed behaviour used by the Filters/Legend buttons.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // How many outside clicks dismiss the popover. Search uses 2 so the FIRST board click can
  // pan/inspect the highlighted matches without losing the search; a second (within ~1.5s)
  // closes. Filters/Legend keep the default 1 (immediate close).
  outsideClicksToClose?: number;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  // Flip the panel above the trigger when it sits low in the viewport (e.g. the legend button
  // stacked above the canvas Controls) so it isn't clipped by the bottom of the window.
  const [placement, setPlacement] = useState<"down" | "up">("down");
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest close fn reachable from the window listeners without re-subscribing.
  // Assigned in an effect (never during render) so it follows the rules of React.
  const closeRef = useRef<() => void>(() => {});
  useEffect(() => {
    closeRef.current = () => setOpen(false);
  });
  // On open, measure the TRIGGER (first child) and open upward if there isn't room below it for
  // the panel — so a legend/filter button near the bottom of the canvas doesn't clip off-screen.
  useEffect(() => {
    if (!open) return;
    const r = (ref.current?.firstElementChild as HTMLElement | null)?.getBoundingClientRect();
    if (!r) return;
    setPlacement(window.innerHeight - r.bottom < 260 ? "up" : "down");
  }, [open]);
  useEffect(() => {
    if (!open) return;
    // Outside-click dismissal. When >1 clicks are required, count consecutive outside clicks
    // and only close once the threshold is reached; the count resets after a short idle window
    // or on any click back inside, so panning the board to inspect matches doesn't close it.
    let outsideClicks = 0;
    let resetTimer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = () => {
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = null;
    };
    const onDown = (e: MouseEvent) => {
      const inside = ref.current?.contains(e.target as Node);
      if (inside) {
        outsideClicks = 0; // interacting with the popover re-arms the grace click
        clearTimer();
        return;
      }
      if (outsideClicksToClose <= 1) {
        closeRef.current();
        return;
      }
      outsideClicks += 1;
      if (outsideClicks >= outsideClicksToClose) {
        outsideClicks = 0;
        clearTimer();
        closeRef.current();
      } else {
        clearTimer();
        resetTimer = setTimeout(() => {
          outsideClicks = 0;
        }, 1500);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current(); // Escape always closes immediately
    };
    // Capture phase: React Flow's d3-zoom calls stopImmediatePropagation() on the board's
    // mousedown during bubbling, so a bubble-phase window listener never sees clicks on the
    // canvas — the popover wouldn't dismiss when you click the board. Capture fires before
    // React Flow can stop the event.
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimer();
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, outsideClicksToClose]);
  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen(!open))}
      {open && (
        <div
          className={cn(
            "glass absolute z-30 w-64 rounded-xl p-3 shadow-xl",
            placement === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {title && (
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {title}
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

// A labeled section inside a popover. Children are usually a row of `Chip`s.
export function PopoverSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        {title}
      </div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

// Toggle-pill used inside filter popovers. The coloured `tone` variants give a
// filter chip a recognisable accent (e.g. danger = red, accent = blue).
export function Chip({
  on,
  onClick,
  children,
  tone = "default",
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  tone?: "default" | "danger" | "accent";
}) {
  const palette = {
    default: on
      ? "border-foreground/40 bg-[var(--ink-active)] text-foreground"
      : "border-border text-muted-foreground hover:text-foreground",
    danger: on
      ? "border-red-500/40 bg-red-500/15 text-red-300"
      : "border-border text-muted-foreground hover:text-foreground",
    accent: on
      ? "border-sky-500/40 bg-sky-500/15 text-sky-300"
      : "border-border text-muted-foreground hover:text-foreground",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
        palette[tone],
      )}
    >
      {children}
    </button>
  );
}
