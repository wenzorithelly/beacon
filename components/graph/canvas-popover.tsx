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
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  title?: string;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div
          className={cn(
            "glass absolute top-full z-30 mt-1.5 w-64 rounded-xl p-3 shadow-xl",
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
      ? "border-foreground/40 bg-white/10 text-foreground"
      : "border-white/10 text-muted-foreground hover:text-foreground",
    danger: on
      ? "border-red-500/40 bg-red-500/15 text-red-300"
      : "border-white/10 text-muted-foreground hover:text-foreground",
    accent: on
      ? "border-sky-500/40 bg-sky-500/15 text-sky-300"
      : "border-white/10 text-muted-foreground hover:text-foreground",
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
