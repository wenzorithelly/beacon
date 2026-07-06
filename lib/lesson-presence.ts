import { makePresence } from "@/lib/make-presence";

// Per-workspace "a /learn tab is open for this repo" heartbeat — the lesson analog of
// lib/plan-presence. The /learn surface POSTs a beat while mounted; the beacon_explain tool reads
// it before opening the browser, so a re-pushed lesson lands in the already-open tab (which polls
// /api/lesson) instead of spawning a duplicate. Deterministic: just a timestamp on disk.

const p = makePresence("lesson-presence.json", 20_000);
export const LESSON_PRESENCE_TTL_MS = p.ttlMs;
export const isLessonPresenceLive = p.isLiveAt;
export const recordLessonPresence = p.record;
export const readLessonPresenceTs = p.readTs;
export const isLessonTabLive = p.isLive;
