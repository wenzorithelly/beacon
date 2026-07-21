import { makePresence } from "@/lib/make-presence";

// Per-workspace "a client can deliver input into this workspace's agent session" heartbeat. ANY
// client can register by heartbeating POST /api/deliverer — the daemon has ZERO awareness of what
// kind of client it is (a desktop shell, a browser extension, whatever); see app/api/deliverer/
// route.ts. A live deliverer is what flips an ask's option buttons from a read-only hint to
// actually clickable (components/ask/ask-modal.tsx) and is what POST /api/ask/deliver checks before
// accepting a delivery (lib/ask-delivery). TTL/heartbeat pattern mirrors tab-/view-/plan-presence
// (lib/make-presence) so a deliverer that crashed or closed stops advertising itself automatically
// instead of leaving a stale "clickable" UI with nothing on the other end.

// Generous relative to the expected ~5s heartbeat cadence, but short enough that a closed app stops
// advertising within one missed poll cycle of the ask-modal (POLL_MS there).
const p = makePresence("deliverer-presence.json", 15_000);
export const DELIVERER_PRESENCE_TTL_MS = p.ttlMs;
export const isDelivererLive = p.isLive;
// Explicit-timestamp freshness check (vs. isDelivererLive's implicit readTs()) — lets a caller that
// already fetched the raw ts over HTTP (see lib/open-review.ts's desktop-vs-browser routing) redo
// the SAME freshness math locally instead of a second round trip.
export const isDelivererLiveAt = p.isLiveAt;
export const recordDelivererPresence = p.record;
export const readDelivererPresenceTs = p.readTs;
// What a live deliverer advertises it can type — e.g. "multiSelect"/"freeText" (see
// components/ask/ask-modal.tsx) — gating those surfaces on the SAME liveness check as clickability
// itself. [] once stale, same as an old deliverer that never wrote `caps` at all.
export const delivererCaps = (now: number): string[] => (p.isLive(now) ? p.readCaps() : []);
