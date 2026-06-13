"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { currentTabWs, isApiRequest, TAB_WS_KEY } from "@/lib/tab-ws";

// Makes "one tab per workspace" actually hold. Two effects, both client-only:
//
// 1. Pin every client /api request to THIS tab's workspace by attaching the x-beacon-workspace
//    header — so the browser-wide `beacon_ws` cookie can never drag a tab's reads/writes to
//    another repo. One interceptor covers every call site (current + future) instead of threading
//    a header through dozens of fetches; scoped to same-origin /api/* and it never clobbers an
//    explicit header (so /plan's own wsHeaders still win). EventSource (live-refresh) is not fetch
//    and pins via its own ?ws, so it's unaffected.
//
// 2. Keep the pin sticky: if a navigation dropped the ?ws param but this tab has a stored
//    workspace, put ?ws back so the SERVER render pins to it instead of falling back to the cookie.
export function TabWorkspace() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const orig = window.fetch;
    if ((orig as { __beaconPinned?: boolean }).__beaconPinned) return;
    const patched = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      try {
        const ws = currentTabWs();
        if (ws) {
          const origin = window.location.origin;
          if (input instanceof Request) {
            if (isApiRequest(input.url, origin) && !input.headers.has("x-beacon-workspace")) {
              const headers = new Headers(input.headers);
              headers.set("x-beacon-workspace", ws);
              return orig(new Request(input, { headers }), init);
            }
          } else {
            const url = typeof input === "string" ? input : input.href;
            if (isApiRequest(url, origin)) {
              const headers = new Headers(init?.headers);
              if (!headers.has("x-beacon-workspace")) {
                headers.set("x-beacon-workspace", ws);
                return orig(input, { ...init, headers });
              }
            }
          }
        }
      } catch {
        /* never break a fetch because of pinning */
      }
      return orig(input, init);
    };
    (patched as { __beaconPinned?: boolean }).__beaconPinned = true;
    window.fetch = patched as typeof window.fetch;
    return () => {
      window.fetch = orig;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const param = new URLSearchParams(window.location.search).get("ws");
    if (param) {
      try {
        sessionStorage.setItem(TAB_WS_KEY, param);
      } catch {
        /* ignore */
      }
      return;
    }
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(TAB_WS_KEY);
    } catch {
      /* ignore */
    }
    if (!stored) return;
    const sp = new URLSearchParams(window.location.search);
    sp.set("ws", stored);
    router.replace(`${pathname}?${sp.toString()}`);
  }, [pathname, router]);

  return null;
}
