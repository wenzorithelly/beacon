"use client";

import type { ReactNode } from "react";

// Wraps the page content. The agent-view panel now floats over the canvas as a true
// overlay, so this no longer reserves a left gutter — pages take the full width.
export function MainRegion({ children }: { children: ReactNode }) {
  return <main className="flex flex-1 flex-col">{children}</main>;
}
