"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// Centralized selection context so the global command bar knows what the user is
// currently working on (the selected table / endpoint / feature node), without prop
// drilling. Pages publish their selection; the command bar reads it.

export type AiSelection = { kind: string; label: string; id: string } | null;

interface AiCtx {
  selection: AiSelection;
  setSelection: (s: AiSelection) => void;
}

const Ctx = createContext<AiCtx | null>(null);

export function AiContextProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<AiSelection>(null);
  return <Ctx.Provider value={{ selection, setSelection }}>{children}</Ctx.Provider>;
}

export function useAiContext(): AiCtx {
  return useContext(Ctx) ?? { selection: null, setSelection: () => {} };
}
