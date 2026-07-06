"use client";

import { useEffect } from "react";
import {
  applyAppearance,
  getSurface,
  getTheme,
  SURFACE_KEY,
  THEME_KEY,
} from "@/lib/appearance";

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
  return null;
}
