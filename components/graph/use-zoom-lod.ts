"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@xyflow/react";
import { lodForZoom, type Lod, type LodThresholds } from "@/lib/zoom-lod";

// Semantic-zoom level for the current canvas. Must run under React Flow context (node
// components, or any child of <ReactFlow>). The hysteresis lives in lib/zoom-lod (pure,
// tested); the previous level rides in state via the adjust-during-render pattern, so the
// dead band works across renders. The selector returns a string, so zoom changes WITHIN a
// level never re-render the consumer — only actual level transitions do.
// `thresholds` must be a stable reference (a module-level const) when provided.
export function useZoomLOD(thresholds?: LodThresholds): Lod {
  const [prev, setPrev] = useState<Lod>("full");
  const lod = useStore((s) => lodForZoom(s.transform[2], prev, thresholds));
  if (lod !== prev) setPrev(lod);
  return lod;
}

// MapClient/DbMapClient render OUTSIDE the React Flow context (no provider wrapper), so this
// tiny child lifts the LOD into their state (edge hiding, region summaries).
export function LodReporter({
  onLod,
  thresholds,
}: {
  onLod: (lod: Lod) => void;
  thresholds?: LodThresholds;
}) {
  const lod = useZoomLOD(thresholds);
  const last = useRef<Lod | null>(null);
  useEffect(() => {
    if (last.current !== lod) {
      last.current = lod;
      onLod(lod);
    }
  }, [lod, onLod]);
  return null;
}
