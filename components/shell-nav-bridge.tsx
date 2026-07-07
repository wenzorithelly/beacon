"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Desktop-shell seam. The shell draws the navigation in its own chrome view (a separate
// WebContentsView); when the user clicks a nav item there, the shell preload re-dispatches its IPC as
// a `beacon:shell-navigate` DOM event on window. Here we perform a SOFT router.push so navigation is
// instant with no reload — the shell prefers this over loadURL. A no-op in a plain browser (the event
// is never dispatched there). The Notes-drawer toggle seam lives in notes-context (it needs the Notes
// context); this component handles only route navigation.
export function ShellNavBridge() {
  const router = useRouter();
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const href = (e as CustomEvent<{ href?: string }>).detail?.href;
      if (typeof href === "string" && href) router.push(href);
    };
    window.addEventListener("beacon:shell-navigate", onNavigate as EventListener);
    return () => window.removeEventListener("beacon:shell-navigate", onNavigate as EventListener);
  }, [router]);
  return null;
}
