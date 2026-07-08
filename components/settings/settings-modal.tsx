"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { BeaconMark } from "@/components/beacon-mark";
import { buildTabHref, currentTabWs } from "@/lib/tab-ws";
import { cn } from "@/lib/utils";

// One settings section = one rail row + its content pane. `group` clusters rows under a quiet
// header (like the Claude-desktop settings dialog); the server builds these so the delete-workspace
// card can target this tab's repo. Content is the existing settings cards, unchanged.
export type SettingsSection = {
  id: string;
  label: string;
  group: string;
  icon?: ReactNode;
  content: ReactNode;
};

// ── Direct-wins dedup ───────────────────────────────────────────────────────────────────────
// A bare `/settings` hard load renders the DIRECT modal (app/settings/page.tsx), then the per-tab
// ws-pin (components/tab-workspace) does router.replace('/settings?ws=…') — a client nav that
// re-triggers the (.)settings interceptor and mounts a SECOND, identical modal in the @modal slot.
// Since router.replace is async, the direct modal's register-effect always runs before the
// intercepted one mounts, so the intercepted instance can reliably yield to the direct one. A tiny
// client-singleton store tracks whether a direct modal is mounted; the intercepted modal renders
// null while it is. On a normal soft nav (Settings pill / shell), no direct modal exists, so the
// intercepted one shows as usual.
let directCount = 0;
const directSubs = new Set<() => void>();
function registerDirectModal(): () => void {
  directCount += 1;
  directSubs.forEach((s) => s());
  return () => {
    directCount -= 1;
    directSubs.forEach((s) => s());
  };
}
function subscribeDirectModal(cb: () => void): () => void {
  directSubs.add(cb);
  return () => {
    directSubs.delete(cb);
  };
}
const getDirectMounted = () => directCount > 0;

// The /settings surface, as a centered modal over the board. Rendered two ways:
//   • intercepted (soft nav) — overlays the LIVE board via the @modal parallel slot; closing
//     returns to it with router.back().
//   • direct load (hard nav) — the real /settings route renders it over a board backdrop; there's
//     no in-app history, so closing pushes /map (this tab's workspace preserved).
// base-ui's Dialog gives us the focus trap, Escape, restore-focus, scroll-lock, and outside-press
// dismiss for free; we only drive open→navigate.
export function SettingsModal({
  sections,
  intercepted,
}: {
  sections: SettingsSection[];
  intercepted: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(sections[0]?.id);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // The direct modal claims ownership; the intercepted one yields to it (see the store above).
  const directPresent = useSyncExternalStore(subscribeDirectModal, getDirectMounted, () => false);
  useEffect(() => {
    if (intercepted) return;
    return registerDirectModal();
  }, [intercepted]);

  const current = sections.find((s) => s.id === active) ?? sections[0];

  // Live label/group match — quiet, client-side, no fetch. Groups render in first-seen order and
  // vanish when none of their rows match.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const order: string[] = [];
    const byGroup = new Map<string, SettingsSection[]>();
    for (const s of sections) {
      if (q && !s.label.toLowerCase().includes(q) && !s.group.toLowerCase().includes(q)) continue;
      if (!byGroup.has(s.group)) {
        byGroup.set(s.group, []);
        order.push(s.group);
      }
      byGroup.get(s.group)!.push(s);
    }
    return order.map((g) => ({ label: g, items: byGroup.get(g)! }));
  }, [sections, query]);

  function close() {
    setOpen(false);
    if (intercepted) router.back();
    else router.push(buildTabHref("/map", currentTabWs()));
  }

  // Yield to the direct modal when both would render for the same /settings URL (deep-load + ws-pin
  // replace) — the direct one owns the screen and closes to /map; this avoids two stacked dialogs.
  if (intercepted && directPresent) return null;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogPrimitive.Portal>
        {/* Scrim: dims + blurs the board behind so the modal reads as a lens over your work. */}
        <DialogPrimitive.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-black/45 supports-backdrop-filter:backdrop-blur-[3px]",
            "duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Popup
          initialFocus={searchRef}
          className={cn(
            "glass fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl outline-none",
            "h-[min(680px,calc(100vh-80px))] w-[min(1000px,calc(100vw-80px))] max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)]",
            "flex-col sm:flex-row",
            "duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-[0.98]",
          )}
          // Heavier, softer lift than the default glass card so the panel floats above the board;
          // keeps the glass inset sheen. Theme-aware via --glass-shadow / --glass-sheen.
          style={{
            boxShadow:
              "0 40px 120px -32px var(--glass-shadow), 0 12px 40px -20px var(--glass-shadow), inset 0 1px 0 var(--glass-sheen)",
          }}
        >
          {/* ── Left rail: brand eyebrow · title · search · grouped nav ─────────────────────── */}
          <aside className="flex shrink-0 flex-col border-b border-border sm:w-[240px] sm:border-b-0 sm:border-r">
            <div className="px-4 pt-4">
              <div className="mb-2 flex items-center gap-1.5">
                <BeaconMark size={14} className="text-muted-foreground" />
                <span className="text-[12px] font-medium tracking-tight text-muted-foreground">
                  Beacon
                </span>
              </div>
              <DialogPrimitive.Title className="text-[15px] font-semibold tracking-tight">
                Settings
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                Change appearance, agent, integration and project settings.
              </DialogPrimitive.Description>
            </div>

            <div className="px-3 pb-2 pt-3">
              <div className="relative">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search settings"
                  placeholder="Search settings"
                  className={cn(
                    "h-8 w-full rounded-lg border border-border bg-transparent pl-8 pr-2.5 text-[13px] outline-none transition-colors",
                    "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  )}
                />
              </div>
            </div>

            <nav
              aria-label="Settings sections"
              className="flex gap-1 overflow-x-auto px-3 pb-3 sm:flex-1 sm:flex-col sm:gap-0.5 sm:overflow-x-visible sm:overflow-y-auto"
            >
              {groups.length === 0 ? (
                <p className="px-1 py-2 text-[12px] text-muted-foreground">No settings match.</p>
              ) : (
                groups.map((g) => (
                  <div key={g.label} className="shrink-0 sm:mt-3 sm:first:mt-1">
                    <p className="hidden px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 sm:block">
                      {g.label}
                    </p>
                    <div className="flex gap-1 sm:flex-col sm:gap-0.5">
                      {g.items.map((s) => {
                        const on = s.id === active;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            aria-current={on ? "page" : undefined}
                            onClick={() => setActive(s.id)}
                            className={cn(
                              "group flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors sm:w-full",
                              on
                                ? "bg-[var(--ink-active)] text-foreground"
                                : "text-muted-foreground hover:bg-[var(--ink-hover)] hover:text-foreground",
                            )}
                          >
                            {s.icon && (
                              <span
                                aria-hidden
                                className={cn(
                                  "shrink-0 transition-colors",
                                  on
                                    ? "text-[var(--accent-2,#ff7a45)]"
                                    : "text-muted-foreground group-hover:text-foreground",
                                )}
                              >
                                {s.icon}
                              </span>
                            )}
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </nav>
          </aside>

          {/* ── Content pane: the active section's existing cards, scrollable ───────────────── */}
          <div className="relative min-w-0 flex-1 overflow-y-auto">
            <DialogPrimitive.Close
              aria-label="Close settings"
              className={cn(
                "absolute right-3 top-3 z-10 flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors",
                "hover:bg-[var(--ink-hover)] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
              )}
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
            <div className="space-y-4 px-5 py-6 sm:px-7 sm:py-7">{current?.content}</div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
