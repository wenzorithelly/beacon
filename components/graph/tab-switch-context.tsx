"use client";

import { createContext, useContext } from "react";

// Lets the in-canvas <CanvasTabs/> switch the active board WITHOUT a server navigation when the
// target board is one the <MapTabsShell/> keeps mounted (Roadmap / Architecture / Database — all
// bounded by curated planning-entity counts, so cheap to hold in memory at once). Tabs for views
// NOT in `views` (Files, whose code-graph scales with repo size) fall back to a normal <Link> so
// that heavy data is only fetched when the tab is actually opened.
export type ShellView = "ROADMAP" | "ARCHITECTURE" | "DATABASE";

export const SHELL_VIEWS: ReadonlySet<string> = new Set<ShellView>([
  "ROADMAP",
  "ARCHITECTURE",
  "DATABASE",
]);

export interface TabSwitch {
  /** Views this shell can switch to client-side; any other tab navigates normally. */
  views: ReadonlySet<string>;
  switchTo: (view: ShellView) => void;
}

export const TabSwitchContext = createContext<TabSwitch | null>(null);

/** Null when rendered outside the shell (e.g. the standalone Files board) — caller uses <Link>. */
export function useTabSwitch(): TabSwitch | null {
  return useContext(TabSwitchContext);
}
