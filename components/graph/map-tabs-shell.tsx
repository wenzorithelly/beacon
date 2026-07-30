"use client";

import { useCallback, useState, type ReactNode } from "react";
import { SHELL_VIEWS, TabSwitchContext, type ShellView } from "./tab-switch-context";

// Client shell that hosts the three bounded boards (Roadmap / Architecture / Database) so
// switching between them is INSTANT — no server round-trip, no canvas remount, no fitView
// re-measure (the old <Link href="/map?view=X"> did all three on every tab click). Each board is
// passed pre-rendered from the server page; we mount one lazily on first visit and keep it mounted
// after, toggling visibility with display (contents ↔ none) so its React Flow viewport (pan/zoom)
// survives the switch. The URL is kept in sync via history.replaceState — a refresh or a shared
// link still lands on the right tab — WITHOUT triggering a Next navigation (router.replace would
// re-run the server component and defeat the whole point).
const ORDER: ShellView[] = ["ROADMAP", "ARCHITECTURE", "DATABASE"];

export function MapTabsShell({
  initialView,
  roadmap,
  architecture,
  database,
}: {
  initialView: ShellView;
  roadmap: ReactNode;
  architecture: ReactNode;
  database: ReactNode;
}) {
  const [view, setView] = useState<ShellView>(initialView);
  // Lazy-mount: only boards the user has actually opened are in the tree. The initial board mounts
  // visible (correct fitView); a board added here later also mounts while visible, never at 0×0.
  const [mounted, setMounted] = useState<Set<ShellView>>(() => new Set([initialView]));

  const switchTo = useCallback((next: ShellView) => {
    setView(next);
    setMounted((m) => (m.has(next) ? m : new Set(m).add(next)));
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("view", next);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* URL sync is best-effort; the board still switches if it fails. */
    }
  }, []);

  const content: Record<ShellView, ReactNode> = {
    ROADMAP: roadmap,
    ARCHITECTURE: architecture,
    DATABASE: database,
  };

  return (
    <TabSwitchContext.Provider value={{ views: SHELL_VIEWS, switchTo }}>
      {ORDER.map((v) =>
        mounted.has(v) ? (
          // `contents` keeps the active board laid out exactly as if it were the page's direct
          // child (no extra box); `hidden` (display:none) parks the inactive ones at zero size
          // while preserving their mounted React Flow instance + viewport.
          <div key={v} className={view === v ? "contents" : "hidden"}>
            {content[v]}
          </div>
        ) : null,
      )}
    </TabSwitchContext.Provider>
  );
}
