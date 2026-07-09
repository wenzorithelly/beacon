"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// Centralized open/close state for the global Notes drawer, so the top-nav button (in the
// layout) and the drawer (also in the layout) share one source of truth without prop
// drilling — mirrors PlanProvider. The drawer slides over whatever page you're on.

interface NotesCtx {
  open: boolean;
  openDrawer: () => void;
  close: () => void;
  toggle: () => void;
}

const Ctx = createContext<NotesCtx | null>(null);

export function NotesProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openDrawer = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  // Desktop-shell seam: the shell chrome's Notes control toggles the drawer over a generic DOM event
  // (preload re-dispatches its IPC as beacon:shell-notes-toggle). A no-op in a plain browser.
  useEffect(() => {
    const onToggle = () => toggle();
    window.addEventListener("beacon:shell-notes-toggle", onToggle);
    return () => window.removeEventListener("beacon:shell-notes-toggle", onToggle);
  }, [toggle]);
  // …and reports the drawer's state back the same generic way, so the shell's Notes control can
  // light up while the drawer is open (any trigger that opens a panel shows its open state).
  // Harmless in a plain browser: nothing listens.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("beacon:shell-notes-state", { detail: { open } }));
  }, [open]);
  const value = useMemo(() => ({ open, openDrawer, close, toggle }), [open, openDrawer, close, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotes(): NotesCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNotes must be used inside NotesProvider");
  return ctx;
}
