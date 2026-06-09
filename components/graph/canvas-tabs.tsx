"use client";

import Link from "next/link";
import { Database, FolderTree, MapPinned, Network } from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

// Top-center canvas tabs shared by /map's four views. Style matches the verdict pill on
// /plan: filled rounded-md background on the active tab, muted text + icon on the rest.

export type CanvasTab = {
  value: string;
  label: string;
  href: string;
  /** Optional override; otherwise we pick by `value`. */
  Icon?: ComponentType<{ className?: string }>;
};

const ICON_BY_VALUE: Record<string, ComponentType<{ className?: string }>> = {
  ROADMAP: MapPinned,
  ARCHITECTURE: Network,
  FILES: FolderTree,
  DATABASE: Database,
};

export function CanvasTabs({ tabs, active }: { tabs: CanvasTab[]; active: string }) {
  return (
    <div className="flex items-center gap-0.5">
      {tabs.map((t) => {
        const on = t.value === active;
        const Icon = t.Icon ?? ICON_BY_VALUE[t.value];
        return (
          <Link
            key={t.value}
            href={t.href}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium tracking-tight transition-colors",
              on
                ? "bg-white/10 text-foreground"
                : "text-muted-foreground/80 hover:bg-white/5 hover:text-foreground",
            )}
          >
            {Icon ? <Icon className="size-3" /> : null}
            <span>{t.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
