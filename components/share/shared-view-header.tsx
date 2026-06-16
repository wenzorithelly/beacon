"use client";

import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";

// The chrome shared by both read-only viewers (SharedBoardView / SharedPlanView): the Read-only
// badge, the "<label> <workspace> · <date>" line, an optional plan verdict, and the "Made with
// Beacon" link. Built to never overflow on a phone — the label flexes + truncates while every
// other element stays at its intrinsic width.
export function SharedViewHeader({
  label,
  workspaceLabel,
  createdAt,
  verdict,
}: {
  label: string;
  workspaceLabel: string;
  createdAt: number;
  verdict?: "approved" | "discarded" | null;
}) {
  return (
    <header className="relative z-20 flex h-12 shrink-0 items-center gap-2 border-b border-white/5 bg-card/40 px-3 backdrop-blur sm:gap-3 sm:px-4">
      <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Eye className="size-3" /> Read-only
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
        {label} <span className="text-foreground">{workspaceLabel}</span>
        {" · "}
        {new Date(createdAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </span>
      {verdict && (
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
            verdict === "approved"
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-red-500/15 text-red-300",
          )}
        >
          {verdict}
        </span>
      )}
      <a
        href="https://www.trybeacon.sh"
        target="_blank"
        rel="noreferrer"
        className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="hidden sm:inline">Made with </span>Beacon
      </a>
    </header>
  );
}
