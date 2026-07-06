import { makePresence } from "@/lib/make-presence";

// Per-workspace "a Beacon tab is open for this repo" heartbeat, recorded SERVER-SIDE by the SSE
// stream tick (app/api/stream) — an open EventSource IS a live tab — so it covers EVERY page with
// no client interval, and keeps ticking even for a BACKGROUNDED tab (server timers aren't
// throttled). The `beacon` CLI reads it before opening a browser so a live tab is reused instead of
// duplicated. NOTE: because it stays live behind the terminal, this is NOT "the user is looking" —
// that's lib/view-presence (client-beaten, focus-gated), which the ask bridge uses instead.

// The stream ticks every 1s; tolerate a handful of missed ticks before treating the tab as gone.
const p = makePresence("tab-presence.json", 10_000);
export const TAB_PRESENCE_TTL_MS = p.ttlMs;
export const isTabPresenceLive = p.isLiveAt;
export const recordTabPresence = p.record;
export const readTabPresenceTs = p.readTs;
export const isTabLive = p.isLive;
