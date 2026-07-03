// Shared display metadata for node statuses and clusters.
// Used by the map node cards and the detail sidebar.

export const VIEWS = ["ROADMAP", "ARCHITECTURE"] as const;
export type View = (typeof VIEWS)[number];

export const ROADMAP_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "DONE",
  "BLOCKED",
  "CANCELLED",
  "DEPRIORITIZED",
] as const;

export const ARCH_STATUSES = ["KEEP", "REBUILD", "REPLACE", "DROP"] as const;

// Lane ordering for the roadmap "Group by: status" arrange — a Now → Next → Later → archive
// reading order. Intentionally DIFFERENT from ROADMAP_STATUSES (which leads with PENDING):
// when laying the board into status lanes you want active work first, finished/dropped last.
export const STATUS_LANE_ORDER = [
  "IN_PROGRESS",
  "PENDING",
  "BLOCKED",
  "DONE",
  "DEPRIORITIZED",
  "CANCELLED",
] as const;

interface Meta {
  label: string;
  className: string;
}

// Node status (covers both ROADMAP and ARCHITECTURE values).
export const STATUS_META: Record<string, Meta> = {
  // roadmap
  DONE: { label: "Done", className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" },
  IN_PROGRESS: { label: "In progress", className: "border-sky-500/30 bg-sky-500/15 text-sky-300" },
  PENDING: { label: "Pending", className: "border-amber-500/30 bg-amber-500/10 text-amber-200" },
  BLOCKED: { label: "Blocked", className: "border-orange-500/30 bg-orange-500/15 text-orange-300" },
  CANCELLED: { label: "Cancelled", className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400 line-through" },
  DEPRIORITIZED: { label: "Deprioritized", className: "border-zinc-600/40 bg-zinc-600/10 text-zinc-400" },
  // architecture disposition
  KEEP: { label: "Keep", className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" },
  REBUILD: { label: "Rebuild", className: "border-violet-500/30 bg-violet-500/15 text-violet-300" },
  REPLACE: { label: "Replace", className: "border-rose-500/30 bg-rose-500/15 text-rose-300" },
  DROP: { label: "Drop", className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400 line-through" },
};

// ── Plan review loop timing ──────────────────────────────────────────────────
// How often the blocking pollers check for the user's verdict, and how long each blocking call
// runs before it must hand back a RESUMABLE signal. Both surfaces are bounded by Claude Code, not
// by us: it KILLS the ExitPlanMode `command` hook at a hard 600s (10-min) wall, and kills an MCP
// tool call at its own wall. The verdict persists on disk and a re-push of the SAME plan hits the
// /api/plan resume guard (no reset), so re-arming resumes the SAME review losslessly — that's what
// lets a slow review outlive these walls instead of staling the session.
export const PLAN_POLL_INTERVAL_MS = 1500;
// The ExitPlanMode hook polls only until here, then returns a "call ExitPlanMode again to keep
// waiting" decision — deliberately BEFORE Claude Code's hard 600s hook wall (which can't be raised
// and, when hit, kills the hook silently and drops the user to a terminal permission prompt). The
// gap to 600s is headroom for hook startup (self-heal + daemon boot).
export const PLAN_HOOK_REARM_MS = 8 * 60 * 1000; // 8 min
// The `beacon ask` bridge (bin/ask.ts): a question re-asked with the same content within this
// window of being answered is treated as an agent retry-loop and let through to the terminal
// instead of re-surfacing in Beacon. See lib/ask-store.isLoopRepush.
export const ASK_LOOP_GUARD_MS = 60 * 1000; // 60s
export const PLAN_TOOL_TIMEOUT_MS = 30 * 60 * 1000; // 30 min — MCP tool call internal loop (resumable)
// Per-tool wall-clock timeout written into each repo's .mcp.json for the Beacon MCP server. MUST
// exceed PLAN_TOOL_TIMEOUT_MS so the blocking plan tools finish their loop and return a resumable
// "call again" message BEFORE Claude Code's MCP client gives up. With no timeout set, that client
// default (~10 min) fired mid-review and staled the session.
export const BEACON_MCP_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

// How often the `beacon mcp` process polls the daemon's per-workspace sync version to
// forward a resources/list_changed to the @-mention client. Runs for the whole session, so
// it's gentler than the plan poll — a few seconds' lag before a new note/feature appears is
// fine, and localhost GETs are cheap.
export const RESOURCE_POLL_INTERVAL_MS = 3000;

// Clusters are free-form domain tags (AUTH, SEARCH, INTEL, …) chosen per project,
// so the label is just the raw value with an em-dash fallback for unset.
export function clusterLabel(cluster: string | null | undefined): string {
  return cluster?.trim() || "—";
}
