"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, MessageSquarePlus, Trash2 } from "lucide-react";
import { usePlan } from "@/components/plan/plan-context";

// Floating review pill for a plan Claude pushed via MCP. Renders ONLY when:
//   (a) there's a pending plan, AND
//   (b) the user isn't already on /plan (where it would be redundant).
// Tapping "Abrir plano" takes the user to the split-screen /plan (plannotator + canvases).
// Beacon is the visualization + verdict surface — your Claude Code terminal session is the
// brain. For plan-mode reviews, plannotator-last in that session handles it independently.

export function PlanBar() {
  const { status, discard } = usePlan();
  const pathname = usePathname();
  if (!status.pending) return null;
  if (pathname === "/plan") return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-40 flex justify-center px-2">
      <div className="pointer-events-auto flex max-w-3xl items-center gap-2 rounded-xl border border-emerald-500/30 bg-card/85 px-3 py-1.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/70">
        <Sparkles className="size-3.5 shrink-0 text-emerald-300" />
        <div className="min-w-0">
          <div className="truncate text-[12px] leading-tight text-foreground">
            <span className="text-emerald-300/80">Plan ready · </span>
            {status.description || "(no description)"}
          </div>
          <div className="text-[10px] leading-tight text-muted-foreground">
            {status.features} feature(s) · {status.tables} table(s) · {status.endpoints}{" "}
            endpoint(s)
          </div>
        </div>
        <Link
          href="/plan"
          className="flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25"
          title="Open Plannotator + canvases side by side"
        >
          <MessageSquarePlus className="size-3" /> Open plan
        </Link>
        <button
          onClick={discard}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-red-500/15 hover:text-red-300"
          title="Discard the plan"
        >
          <Trash2 className="size-3" /> Discard
        </button>
      </div>
    </div>
  );
}
