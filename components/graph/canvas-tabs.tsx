"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Database, FolderTree, MapPinned, Network } from "lucide-react";
import type { ComponentType } from "react";
import { currentTabWs } from "@/lib/tab-ws";
import { useTabSwitch, type ShellView } from "@/components/graph/tab-switch-context";
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
  // Carry this tab's workspace through the view switch (the hrefs arrive as /map?view=X with no
  // ?ws) so clicking Roadmap/Architecture/Database/Files keeps the tab pinned to its repo instead
  // of dropping the pin and falling back to the shared cookie. Read after mount (window-only) so
  // the initial client render matches SSR.
  const [ws, setWs] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWs(currentTabWs());
  }, []);
  const hrefFor = (href: string) =>
    ws ? `${href}${href.includes("?") ? "&" : "?"}ws=${ws}` : href;
  // Present only inside <MapTabsShell/> (the /map roadmap/architecture/database boards): when a
  // tab targets a board the shell keeps mounted, switch it instantly instead of navigating.
  const tabSwitch = useTabSwitch();
  return (
    <div className="flex items-center gap-0.5">
      {tabs.map((t) => {
        const on = t.value === active;
        const Icon = t.Icon ?? ICON_BY_VALUE[t.value];
        const className = cn(
          "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium tracking-tight transition-colors",
          on
            ? "border-white/10 bg-white/[0.07] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
            : "border-transparent text-muted-foreground/80 hover:bg-white/5 hover:text-foreground",
        );
        const inner = (
          <>
            {Icon ? <Icon className={cn("size-3", on && "text-[#ff7a45]")} /> : null}
            {/* Labels collapse to icon-only below `lg` so the right-anchored strip stays narrow
                enough to never collide with the left-pinned top nav on small screens. */}
            <span className="hidden lg:inline">{t.label}</span>
          </>
        );
        if (tabSwitch?.views.has(t.value)) {
          return (
            <button
              key={t.value}
              type="button"
              title={t.label}
              onClick={() => tabSwitch.switchTo(t.value as ShellView)}
              className={className}
            >
              {inner}
            </button>
          );
        }
        return (
          <Link key={t.value} href={hrefFor(t.href)} title={t.label} className={className}>
            {inner}
          </Link>
        );
      })}
    </div>
  );
}
