"use client";

import type { ReactNode } from "react";
import { useAiContext } from "@/components/ai/ai-context";
import { cn } from "@/lib/utils";

// Wraps the page content and reserves room for the left-docked command bar, so the
// chat panel never overlaps page content. Collapsing the bar releases the space.
export function MainRegion({ children }: { children: ReactNode }) {
  const { collapsed } = useAiContext();
  return (
    <main
      className={cn(
        "flex flex-1 flex-col transition-[padding] duration-200",
        collapsed ? "pl-0" : "lg:pl-[21.5rem]",
      )}
    >
      {children}
    </main>
  );
}
