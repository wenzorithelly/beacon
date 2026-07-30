"use client";

import { useEffect } from "react";
import {
  applyAppearance,
  getSurface,
  getTheme,
  setSurface,
  setTheme,
  SURFACE_KEY,
  SURFACES,
  type Surface,
  THEME_KEY,
  THEMES,
  type Theme,
} from "@/lib/appearance";
import { onShellAction, reportShellState, SHELL_SURFACE } from "@/lib/desktop-shell";

// Mounted once in the app shell. The no-flash inline script (THEME_SCRIPT) already set the
// initial theme before paint; this keeps it live afterwards:
//  - while the preference is `auto`, re-apply when the OS light/dark setting flips,
//  - re-apply when another tab changes the preference (storage event).
// Renders nothing.
export function AppearanceSync() {
  useEffect(() => {
    const reapply = () => applyAppearance(getTheme(), getSurface());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY || e.key === SURFACE_KEY) reapply();
    };
    mq.addEventListener("change", reapply);
    window.addEventListener("storage", onStorage);
    // Sync once on mount too, in case the OS setting changed between the pre-paint script and this
    // effect attaching (relevant only in `auto`; a no-op otherwise).
    reapply();
    return () => {
      mq.removeEventListener("change", reapply);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Desktop shell only: it draws theme + surface in its OWN Settings window (the shell's chrome hides
  // this app's top nav, so /settings and its appearance-card are not reachable there — and under the
  // shell these two preferences theme the chrome bar and terminals as well as this page). Report the
  // current pair on mount so that window opens on the right selection; apply what it sends back
  // through the same setters the card uses, so there is one write path and one persisted value.
  // Later changes report themselves — setTheme/setSurface do it (lib/appearance.ts).
  useEffect(() => {
    reportShellState(SHELL_SURFACE.appearance, { theme: getTheme(), surface: getSurface() });
    return onShellAction(SHELL_SURFACE.appearance, (action) => {
      const [kind, value] = action.split(":");
      // Membership, NOT coerceTheme/coerceSurface: those fall back to the DEFAULT on anything they
      // don't recognise, so a malformed action would silently reset the user's theme to dark rather
      // than doing nothing. An action we don't understand is an action we ignore.
      if (kind === "theme" && (THEMES as readonly string[]).includes(value)) setTheme(value as Theme);
      else if (kind === "surface" && (SURFACES as readonly string[]).includes(value)) {
        setSurface(value as Surface);
      }
    });
  }, []);

  return null;
}
