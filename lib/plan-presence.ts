import { makePresence } from "@/lib/make-presence";

// Per-workspace "a /plan tab is open for this repo" heartbeat. The /plan surface POSTs a beat every
// few seconds while mounted; the ExitPlanMode hook (bin/plan.ts) reads it before opening the
// browser, so a revised plan lands in the already-open tab (which polls /api/plan) instead of
// spawning a duplicate. Deterministic: just a timestamp on disk, no AI/CLI.

// The /plan surface beats every 5s; tolerate a few missed beats before treating the tab as gone.
const p = makePresence("plan-presence.json", 20_000);
export const PLAN_PRESENCE_TTL_MS = p.ttlMs;
export const isPlanPresenceLive = p.isLiveAt;
export const recordPlanPresence = p.record;
export const readPlanPresenceTs = p.readTs;
export const isPlanTabLive = p.isLive;
