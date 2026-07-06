"use client";

import { useEffect, useState } from "react";

// React Flow's `colorMode` puts a `.react-flow.dark` class on its canvas root. Beacon's dark
// design tokens are scoped to ANY `.dark` ancestor (@custom-variant dark), so a hardcoded
// colorMode="dark" would re-scope the WHOLE canvas subtree (every node card) to the dark palette
// even when the app is in light theme. This hook mirrors <html data-theme> — the appearance
// system's source of truth, kept current by the no-flash script + AppearanceSync — so the canvas
// follows Light / Dark / Auto. Defaults to "dark" to match the server-rendered markup.
export function useColorMode(): "light" | "dark" {
  const [mode, setMode] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const read = (): "light" | "dark" =>
      document.documentElement.dataset.theme === "light" ? "light" : "dark";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(read());
    const obs = new MutationObserver(() => setMode(read()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    return () => obs.disconnect();
  }, []);
  return mode;
}
