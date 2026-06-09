"use client";

import { type RiskBadge } from "@/lib/risk-badges";
import { cn } from "@/lib/utils";

const TONE: Record<RiskBadge["tone"], string> = {
  danger: "bg-red-500/15 text-red-300",
  warn: "bg-amber-500/15 text-amber-300",
};

// Tiny inline risk flags (DELETE, secrets, auth) for a table/endpoint node. Renders nothing
// when there's no risk, so benign nodes stay clean. Hover any badge for the exact rule.
export function RiskBadgeRow({ badges, className }: { badges: RiskBadge[]; className?: string }) {
  if (!badges.length) return null;
  return (
    <span className={cn("flex shrink-0 items-center gap-0.5", className)}>
      {badges.map((b) => (
        <span
          key={b.label}
          title={b.title}
          className={cn("rounded px-1 text-[8px] font-semibold uppercase tracking-wide", TONE[b.tone])}
        >
          {b.label}
        </span>
      ))}
    </span>
  );
}
