"use client";

import Link from "next/link";
import { Database, FolderTree, MapPinned, Network } from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

// Top-center canvas tabs shared by /map's four views. The strip's container is a glass
// stadium (rounded-full), so the active chip is a CONCENTRIC stadium too — same geometry,
// no clashing corner radii. Active = soft glass fill + hairline border + accent-tinted
// icon; the rest stay muted with a quiet hover.

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
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium tracking-tight transition-colors",
              on
                ? "border-white/10 bg-white/[0.07] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                : "border-transparent text-muted-foreground/80 hover:bg-white/5 hover:text-foreground",
            )}
          >
            {Icon ? <Icon className={cn("size-3", on && "text-[#ff7a45]")} /> : null}
            <span>{t.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
