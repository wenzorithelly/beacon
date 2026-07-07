"use client";

import { BeaconMark } from "@/components/beacon-mark";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SettingsTab = {
  id: string;
  label: string;
  icon?: ReactNode;
  content: ReactNode;
};

// Client tab shell for /settings: the page title sits atop a left nav rail (title + nav labels
// share one left edge), the active section's cards fill the column beside it. The server page
// renders each section's cards (all client components) and hands them in as `content`, so this only
// owns which panel is visible. Only the active panel is mounted, so a card's data fetch runs when
// you open its tab. Collapses to a stacked layout with a scrollable tab strip on narrow screens.
export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
      <aside className="shrink-0 sm:w-52">
        {/* Brand recedes (muted, small), the page title leads — clear rhythm between the two. */}
        <div className="mb-6 flex items-center gap-2 px-3">
          <BeaconMark size={16} className="text-muted-foreground" />
          <span className="text-[13px] font-medium tracking-tight text-muted-foreground">Beacon</span>
        </div>
        <h1 className="mb-5 px-3 text-lg font-semibold tracking-tight">Settings</h1>
        <nav
          role="tablist"
          aria-label="Settings sections"
          className="flex gap-1 overflow-x-auto pb-1 sm:flex-col sm:overflow-visible sm:pb-0"
        >
          {tabs.map((t) => {
            const on = t.id === active;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActive(t.id)}
                className={cn(
                  "group flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-[13px] font-medium transition-colors sm:w-full",
                  on
                    ? "bg-[var(--ink-active)] text-foreground"
                    : "text-muted-foreground hover:bg-[var(--ink-hover)] hover:text-foreground",
                )}
              >
                {t.icon && (
                  <span
                    aria-hidden
                    className={cn(
                      "shrink-0 transition-colors",
                      on
                        ? "text-[var(--accent-2,#ff7a45)]"
                        : "text-muted-foreground group-hover:text-foreground",
                    )}
                  >
                    {t.icon}
                  </span>
                )}
                {t.label}
              </button>
            );
          })}
        </nav>
      </aside>
      {/* Fills the remaining width — no capped column leaving an empty right gutter. */}
      <div className="min-w-0 flex-1 space-y-4" role="tabpanel">
        {current?.content}
      </div>
    </div>
  );
}
