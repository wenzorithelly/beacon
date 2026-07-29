"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { BeaconMark } from "@/components/beacon-mark";
import { sectionSummary, useSummaryVersion } from "@/components/settings/section-summary";
import { buildTabHref, currentTabWs } from "@/lib/tab-ws";
import { cn } from "@/lib/utils";

// One settings section = one rail row + its content pane. The server builds these so the
// delete-workspace card can target this tab's repo.
//
// `group` is gone: with five sections, the General/Connections/Workspace headers were labelling one
// or two rows each. `description` is new — the pane header states what a section is FOR, once, so
// the cards inside it no longer each have to.
export type SettingsSection = {
  id: string;
  label: string;
  /** Shown under the section title in the pane header. One line, plain, no marketing. */
  description?: string;
  /** The settings this section contains, in the words someone would type looking for them. Feeds
   * the rail search so a query for a CONTROL ("opacity") finds the section holding it, instead of
   * only matching section names. Authored next to the content so the two stay adjacent. */
  keywords?: string[];
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

  // Rail-footer version identity, fetched once on mount: the trybeacon install actually SERVING this
  // page (same source as the update banner's currentVersion — see app/api/app-version). The desktop
  // app's own version used to sit under it; it now belongs to the shell's Settings window, which is
  // the surface that knows what a desktop build even is. Failure is silent: an empty footer beats a
  // broken modal.
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/app-version");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && typeof data?.version === "string") setServerVersion(data.version);
        }
      } catch {
        /* offline / route missing — footer line stays empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The direct modal claims ownership; the intercepted one yields to it (see the store above).
  const directPresent = useSyncExternalStore(subscribeDirectModal, getDirectMounted, () => false);
  useEffect(() => {
    if (intercepted) return;
    return registerDirectModal();
  }, [intercepted]);

  // Re-render the rail whenever any card publishes a new value summary (section-summary.tsx). The
  // version counter is the subscription; `sectionSummary(id)` is read per row during render.
  useSummaryVersion();

  const current = sections.find((s) => s.id === active) ?? sections[0];

  // ── Search over SETTINGS, not section names ────────────────────────────────────────────────
  // The old search matched `label`/`group` only: typing "opacity" returned "No settings match"
  // while a Background opacity slider sat two clicks away — a search box that answers "no" about
  // something the app plainly has is worse than no search box. Each section now declares the
  // settings it contains (`keywords`, authored next to the content in settings-sections.tsx), so a
  // query for a CONTROL finds the section holding it.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.keywords?.some((k) => k.toLowerCase().includes(q)),
    );
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
          // No outer drop shadow (owner call, 2026-07-09 — boxes read flat; the backdrop scrim +
          // hairline border carry the separation). Only the glass inset sheen remains.
          style={{
            boxShadow: "inset 0 1px 0 var(--glass-sheen)",
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
              className="flex gap-1 overflow-x-auto px-2 pb-3 sm:flex-1 sm:flex-col sm:gap-0.5 sm:overflow-x-visible sm:overflow-y-auto"
            >
              {matches.length === 0 ? (
                <p className="px-2 py-2 text-[12px] leading-relaxed text-muted-foreground">
                  Nothing matches that. Try a word from the control itself — “blur”, “scrollback”,
                  “shell”.
                </p>
              ) : (
                matches.map((s) => {
                  const on = s.id === active;
                  // The row states its own current value underneath its label, so "what's my
                  // renderer?" is answered by the rail instead of by opening the section. Published
                  // by the cards themselves (section-summary.tsx) — empty until they've loaded, and
                  // absent entirely in a plain browser, in which case the row is just a label.
                  const summary = sectionSummary(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-current={on ? "page" : undefined}
                      onClick={() => setActive(s.id)}
                      className={cn(
                        "group flex shrink-0 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors sm:w-full",
                        "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
                        on
                          ? "bg-[var(--ink-active)]"
                          : "hover:bg-[var(--ink-hover)]",
                      )}
                    >
                      {s.icon && (
                        <span
                          aria-hidden
                          className={cn(
                            "mt-px shrink-0 transition-colors",
                            on
                              ? "text-[var(--accent-2,#ff7a45)]"
                              : "text-muted-foreground group-hover:text-foreground",
                          )}
                        >
                          {s.icon}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span
                          className={cn(
                            "block text-[13px] font-medium leading-tight",
                            on ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                          )}
                        >
                          {s.label}
                        </span>
                        {summary && (
                          <span className="mt-0.5 hidden truncate text-[10.5px] leading-tight text-muted-foreground/70 sm:block">
                            {summary}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </nav>

            {/* ── Rail footer: quiet version identity. Line 1 = the trybeacon install serving the
                app (browser AND shell); line 2 = the desktop app + bundled-vs-attached backend,
                shell only. No card, no border — sm-only because the mobile rail is a top strip
                with no bottom to sit at. */}
            {serverVersion && (
              <div className="hidden shrink-0 px-4 pb-3 pt-2 sm:block">
                {serverVersion && (
                  <p className="text-[10px] text-muted-foreground/70">Beacon v{serverVersion}</p>
                )}
              </div>
            )}
          </aside>

          {/* ── Content pane ───────────────────────────────────────────────────────────────────
              The pane header names the section ONCE. Sections used to be titled up to four times
              over (rail row, card icon, card title, card description) because each held exactly one
              card; the single-card sections now render their content bare. */}
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
            {current && (
              <header className="border-b border-border px-5 pb-3.5 pt-5 pr-14 sm:px-7 sm:pr-16 sm:pt-6">
                <h2 className="text-[16px] font-semibold tracking-[-0.015em]">{current.label}</h2>
                {current.description && (
                  <p className="mt-1 max-w-[62ch] text-[12px] leading-relaxed text-muted-foreground">
                    {current.description}
                  </p>
                )}
              </header>
            )}
            <div className="space-y-4 px-5 py-5 sm:px-7 sm:py-6">{current?.content}</div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
