"use client";

import { ChevronLeft, ChevronRight, Compass, X } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { cn } from "@/lib/utils";
import type { TourStep } from "@/lib/canvas-tour";

// Left-docked steps panel for a guided canvas tour (the detail sidebar is right-docked, so the
// two never collide). Mirrors the UA-style "Project Tour" panel: a numbered, clickable step
// list with the current step's title + deterministic summary up top, and Prev/Next/Done at the
// bottom. All viewport + spotlight behaviour lives in the canvas; this is presentation only.
export function TourOverlay({
  steps,
  index,
  onPrev,
  onNext,
  onExit,
  onGoto,
}: {
  steps: TourStep[];
  index: number;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
  onGoto: (i: number) => void;
}) {
  const step = steps[index];
  if (!step) return null;
  const atStart = index === 0;
  const atEnd = index === steps.length - 1;

  return (
    <GlassPanel className="absolute bottom-3 left-3 top-16 z-10 flex w-72 flex-col rounded-2xl">
      <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Compass className="size-3.5" />
          Guided tour
        </span>
        <button
          onClick={onExit}
          title="End tour (Esc)"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Current step headline */}
      <div className="border-b border-white/10 px-3.5 py-3">
        <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--accent-2,#ff7a45)]">
          Step {index + 1} / {steps.length}
        </div>
        <h2 className="mt-1 break-words text-sm font-semibold leading-tight">{step.title}</h2>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{step.summary}</p>
      </div>

      {/* Step list */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <ol className="space-y-0.5">
          {steps.map((s, i) => (
            <li key={s.id}>
              <button
                onClick={() => onGoto(i)}
                title={s.title}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                  i === index
                    ? "bg-white/[0.08] text-foreground"
                    : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                    i === index
                      ? "bg-[var(--accent-2,#ff7a45)] text-background"
                      : "bg-white/10 text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
                <span className="truncate text-[11px]">{s.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between gap-2 border-t border-white/10 p-2">
        <button
          onClick={onPrev}
          disabled={atStart}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground transition-colors enabled:hover:bg-white/[0.06] enabled:hover:text-foreground disabled:opacity-40"
        >
          <ChevronLeft className="size-3.5" /> Prev
        </button>
        {atEnd ? (
          <button
            onClick={onExit}
            className="rounded-md bg-[var(--accent-2,#ff7a45)]/90 px-3 py-1.5 text-[11px] font-semibold text-background transition-colors hover:bg-[var(--accent-2,#ff7a45)]"
          >
            Done
          </button>
        ) : (
          <button
            onClick={onNext}
            className="flex items-center gap-1 rounded-md bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-white/[0.16]"
          >
            Next <ChevronRight className="size-3.5" />
          </button>
        )}
      </div>
    </GlassPanel>
  );
}
