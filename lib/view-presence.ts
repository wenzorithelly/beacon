import { makePresence } from "@/lib/make-presence";

// Per-workspace "the user is ACTIVELY LOOKING at a Beacon tab for this repo" heartbeat — distinct
// from tab-presence (an open EventSource, which stays live even for a tab hidden behind the
// terminal). The client (components/live-refresh) beats this ONLY while document.visibilityState ===
// "visible" AND document.hasFocus(), i.e. Beacon is the frontmost focused window. The agent-ask
// bridge (bin/ask.ts) gates on THIS so a question is surfaced in Beacon only when the user is there
// to see it; otherwise it falls through to the terminal. Deterministic: a timestamp on disk.

// The client beats every ~3s; kept short (vs tab/plan presence) so a user who just switched to the
// terminal isn't wrongly sent back to Beacon on the next question.
const p = makePresence("view-presence.json", 8_000);
export const VIEW_PRESENCE_TTL_MS = p.ttlMs;
export const isViewPresenceLive = p.isLiveAt;
export const recordViewPresence = p.record;
export const readViewPresenceTs = p.readTs;
export const isViewLive = p.isLive;
