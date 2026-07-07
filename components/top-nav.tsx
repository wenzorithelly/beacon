"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { StickyNote, Plus, SlidersHorizontal } from "lucide-react";
import { BeaconMark } from "@/components/beacon-mark";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { useNotes } from "@/components/notes/notes-context";
import { buildTabHref, currentTabWs } from "@/lib/tab-ws";
import { isDesktopShell } from "@/lib/shell";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/plan", label: "Plans" },
  { href: "/map", label: "Map" },
  { href: "/learn", label: "Learn" },
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

  // Desktop shell only: a "Terminal" surface lives beside the routes. It is NOT a route — clicking it
  // dispatches a DOM event the private shell bridges to its terminal WebContentsView. The shell marks
  // <html data-shell-surface> when the terminal view is shown; we observe that to reflect active state.
  // Invisible in a plain browser (no data-shell → isDesktopShell() is false → no item).
  const [isShell, setIsShell] = useState(false);
  const [surface, setSurface] = useState<"web" | "terminal">("web");
  useEffect(() => {
    // Deliberate: shell detection is client-only (reads the preload-set html attribute) — same
    // mount-time pattern as the ws read above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsShell(isDesktopShell());
    const read = () =>
      setSurface(document.documentElement.dataset.shellSurface === "terminal" ? "terminal" : "web");
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-shell-surface"] });
    return () => mo.disconnect();
  }, []);
  const onTerminal = surface === "terminal";
  return (
    <header
      className={cn(
        isShell
          ? // Desktop shell: ONE full-width title bar — traffic lights inline at macOS's native
            // inset (pl clears them), nav + actions in the same chrome row, hairline bottom edge.
            // The bar itself is the window drag region; interactive groups opt out below.
            "fixed inset-x-0 top-0 z-30 h-9 border-b border-border bg-background/75 backdrop-blur-xl [-webkit-app-region:drag]"
          : "pointer-events-none fixed left-3 top-3 z-30",
      )}
    >
      <div
        className={cn(
          isShell
            ? "pointer-events-auto flex h-full items-center gap-1 pl-[88px] pr-3"
            : "glass pointer-events-auto flex h-10 items-center gap-1 rounded-full pl-3 pr-1.5",
        )}
      >
        <div className={cn("flex items-center gap-1", isShell && "[-webkit-app-region:no-drag]")}>
        {/* The desktop shell's title bar carries no brand — the app IS the brand (the mark lives on
            the Settings page instead); browsers keep the logo as the home link. */}
        {!isShell && (
          <>
            <Link
              href="/"
              className="mr-1 flex items-center gap-2 text-sm font-semibold tracking-tight"
            >
              <BeaconMark size={18} className="text-foreground" />
              {/* Wordmark drops below `lg` (the mark still identifies us) so the left pill stays
                  narrow and clears the right-anchored view tabs on small screens. */}
              <span className="hidden lg:inline">Beacon</span>
            </Link>
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />
          </>
        )}
        <WorkspaceSwitcher fallback={repo} />
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        <nav className="flex items-center gap-0.5 text-sm">
          {LINKS.map((l) => {
            // A web route reads as active only when the terminal surface is NOT covering it.
            const active = (pathname === l.href || pathname.startsWith(l.href + "/")) && !onTerminal;
            return (
              <Link
                key={l.href}
                href={buildTabHref(l.href, ws)}
                onClick={() => {
                  // Navigating to a web route while the terminal surface covers it must also
                  // dismiss the terminal view — otherwise the page changes invisibly behind it.
                  if (onTerminal)
                    window.dispatchEvent(
                      new CustomEvent("beacon:shell-nav", { detail: { surface: "web" } }),
                    );
                }}
                className={cn(
                  "rounded-full tracking-tight transition-colors",
                  isShell ? "px-2.5 py-[3px] text-[12.5px]" : "px-3 py-1 text-[13px]",
                  active
                    ? "bg-[var(--ink-active)] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                    : "text-muted-foreground hover:bg-[var(--ink-hover)] hover:text-foreground",
                )}
              >
                {l.label}
              </Link>
            );
          })}
          {isShell && (
            <button
              type="button"
              aria-pressed={onTerminal}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("beacon:shell-nav", { detail: { surface: onTerminal ? "web" : "terminal" } }),
                )
              }
              className={cn(
                "rounded-full tracking-tight transition-colors",
                isShell ? "px-2.5 py-[3px] text-[12.5px]" : "px-3 py-1 text-[13px]",
                onTerminal
                  ? "bg-[var(--ink-active)] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                  : "text-muted-foreground hover:bg-[var(--ink-hover)] hover:text-foreground",
              )}
            >
              Terminal
            </button>
          )}
        </nav>
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
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
              ? "bg-[var(--ink-active)] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
              : "text-muted-foreground hover:bg-[var(--ink-hover)] hover:text-foreground",
          )}
        >
          <StickyNote className="size-4" />
        </button>
        </div>
        {isShell && <div className="h-full flex-1" />}
        {isShell && onTerminal && (
          <div className="flex items-center gap-1 [-webkit-app-region:no-drag]">
            <button
              type="button"
              aria-label="New terminal"
              title="New terminal (⌘T)"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("beacon:shell-terminal-action", { detail: { action: "new" } }),
                )
              }
              className="flex items-center justify-center rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Terminal settings"
              title="Terminal settings"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("beacon:shell-terminal-action", { detail: { action: "settings" } }),
                )
              }
              className="flex items-center justify-center rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-[var(--ink-hover)] hover:text-foreground"
            >
              <SlidersHorizontal className="size-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
