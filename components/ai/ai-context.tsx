"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// Centralized selection context so the global command bar knows what the user is
// currently working on (the selected table / endpoint / feature node), without prop
// drilling. Pages publish their selection; the command bar reads it.

export type AiSelection = { kind: string; label: string; id: string } | null;

interface AiCtx {
  selection: AiSelection;
  setSelection: (s: AiSelection) => void;
  // The command bar docks on the left; `collapsed` lets the page reclaim that space.
  collapsed: boolean;
  setCollapsed: (c: boolean) => void;
}

const Ctx = createContext<AiCtx | null>(null);

export function AiContextProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<AiSelection>(null);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <Ctx.Provider value={{ selection, setSelection, collapsed, setCollapsed }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAiContext(): AiCtx {
  return (
    useContext(Ctx) ?? {
      selection: null,
      setSelection: () => {},
      collapsed: false,
      setCollapsed: () => {},
    }
  );
}
