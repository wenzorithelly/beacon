"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { StickyNote } from "lucide-react";
import { BeaconMark } from "@/components/beacon-mark";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { useNotes } from "@/components/notes/notes-context";
import { buildTabHref, currentTabWs } from "@/lib/tab-ws";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/plan", label: "Plans" },
  { href: "/map", label: "Map" },
  { href: "/settings", label: "Settings" },
];

// Floats over the canvas top-left so the header doesn't reserve a full-width row.
// The /map canvas's top-center tab strip lives in the same horizontal band visually.
export function TopNav({ repo }: { repo?: string }) {
  const pathname = usePathname();
  const { toggle, open } = useNotes();
  // Carry this tab's workspace through nav so clicking Plans / Map / Settings keeps the tab
  // pinned instead of dropping ?ws and falling back to the shared cookie. Read after mount
  // (window-only) so the initial client render matches SSR (no ?ws), then fills in.
  const [ws, setWs] = useState<string | null>(null);
  useEffect(() => {
    // Deliberate: read the client-only per-tab ws after mount (and on each nav) so links carry it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWs(currentTabWs());
  }, [pathname]);
  return (
    <header className="pointer-events-none fixed left-3 top-3 z-30">
      <div className="glass pointer-events-auto flex h-10 items-center gap-1 rounded-full pl-3 pr-1.5">
        <Link
          href="/"
          className="mr-1 flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <BeaconMark size={18} className="text-foreground" />
          Beacon
        </Link>
        <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />
        <WorkspaceSwitcher fallback={repo} />
        <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />
        <nav className="flex items-center gap-0.5 text-sm">
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={buildTabHref(l.href, ws)}
                className={cn(
                  "rounded-full px-3 py-1 text-[13px] tracking-tight transition-colors",
                  active
                    ? "bg-white/[0.09] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                    : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />
        {/* A drawer toggle, not a page — rendered as an icon button so it reads as a tool
            instead of a fourth route alongside Plans / Map / Settings. */}
        <button
          type="button"
          onClick={toggle}
          aria-pressed={open}
          aria-label="Notes"
          title="Notes"
          className={cn(
            "flex items-center justify-center rounded-full p-1.5 transition-colors",
            open
              ? "bg-white/[0.09] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
              : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
          )}
        >
          <StickyNote className="size-4" />
        </button>
      </div>
    </header>
  );
}
