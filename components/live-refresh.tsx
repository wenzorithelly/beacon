"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Subscribes to the sync-version SSE stream and refreshes the current route
// whenever the intel daemon ingests new code-derived data. EventSource
// auto-reconnects; the first message (current version on connect) is ignored.
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    let primed = false;
    const es = new EventSource("/api/stream");
    es.onmessage = () => {
      if (!primed) {
        primed = true;
        return;
      }
      router.refresh();
    };
    return () => es.close();
  }, [router]);
  return null;
}
