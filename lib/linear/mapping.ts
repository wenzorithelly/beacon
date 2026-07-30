// Pure Linear ↔ Beacon field maps. No I/O, no db — exhaustively unit-tested
// (tests/linear-mapping.test.ts) because this is where a wrong status/priority silently
// corrupts the board.
import type { LinearIssue, LinearWorkflowState, NodeStatus } from "@/lib/linear/types";

const STATE_TYPE_TO_STATUS: Record<string, NodeStatus> = {
  completed: "DONE",
  canceled: "CANCELLED",
  // A real team's "Duplicate" state reports type `duplicate`, not `canceled`. Without this it fell
  // through to the PENDING default, so a duplicate issue came back onto the board as work to do.
  duplicate: "CANCELLED",
  started: "IN_PROGRESS",
  backlog: "PENDING",
  unstarted: "PENDING",
  triage: "PENDING",
};

/** Beacon's internal five, derived from Linear's state TYPE (never its name — teams name states
 *  whatever they like, and the board shows those names verbatim). A type this table doesn't know
 *  falls back to PENDING: "not finished" is the safe guess, and it keeps the card on the board
 *  rather than dropping or completing it. */
export function linearStateToStatus(stateType: string): NodeStatus {
  return STATE_TYPE_TO_STATUS[stateType] ?? "PENDING";
}

/** PURE — map each Beacon status to a concrete Linear workflow-state UUID. Lives here, in the pure
 *  module, because it is BOTH the write-back rule and the rule the columns board groups by: one
 *  definition, so a card can never sit in a column that write-back wouldn't send it to. */
export function stateMapFromStates(states: LinearWorkflowState[]): Partial<Record<NodeStatus, string>> {
  const first = (type: string) => states.find((s) => s.type === type)?.id;
  const map: Partial<Record<NodeStatus, string>> = {};
  const done = first("completed");
  // A team may name its only cancel-ish state "Duplicate" (type `duplicate`); without the fallback
  // CANCELLED resolves to nothing and writing it back silently no-ops.
  const cancelled = first("canceled") ?? first("duplicate");
  const started = first("started");
  const pending = first("unstarted") ?? first("backlog");
  if (done) map.DONE = done;
  if (cancelled) map.CANCELLED = cancelled;
  if (started) map.IN_PROGRESS = started;
  if (pending) map.PENDING = pending;
  // Linear has no "blocked" workflow-state type; a blocked task is in-progress-but-stuck, so BLOCKED
  // writes back as the team's started state. (Round-tripping through Linear reads it back IN_PROGRESS.)
  if (started) map.BLOCKED = started;
  return map;
}

// Linear priority 0=None,1=Urgent,2=High,3=Medium,4=Low → Beacon 0=P0..3=P3 (None → P2).
const LINEAR_TO_BEACON_PRIORITY: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 0: 2 };

export function linearPriorityToBeacon(p: number): number {
  return LINEAR_TO_BEACON_PRIORITY[p] ?? 2;
}

// Write-back inverse (Beacon P2 → Medium). Not a 1:1 round-trip for None, which is fine —
// once a card is synced it always carries a concrete Beacon priority.
export function beaconPriorityToLinear(p: number): number {
  return p + 1;
}

export interface NodeFields {
  title: string;
  plain: string | null;
  status: NodeStatus;
  priority: number;
  kind: "FEATURE" | "BUG";
  cluster: string;
  source: "LINEAR";
  externalId: string;
  sourceRef: string;
  assigneeName: string | null;
  assigneeAvatarUrl: string | null;
  externalMeta: string;
}

/** JSON shape of `NodeFields.externalMeta` — the real workflow state + container identity, for a
 * later UI layer to render/filter by. Null-able members are OMITTED rather than stored as null so
 * the shape stays stable (no `project: null` noise on a teamless-project issue). */
export interface ExternalMeta {
  /** `id` is the workflow-state UUID — what the Status picker keys its selection on. Optional
   *  because rows written before the picker existed carry only name/color/type. */
  state: { id?: string; name: string; color: string; type: string };
  team: { id: string; key: string; name: string };
  project?: { id: string; name: string };
  milestone?: { id: string; name: string };
}

export function buildExternalMeta(issue: LinearIssue): ExternalMeta {
  const meta: ExternalMeta = {
    state: { id: issue.stateId, name: issue.stateName, color: issue.stateColor, type: issue.stateType },
    team: { id: issue.teamId, key: issue.teamKey, name: issue.teamName },
  };
  if (issue.projectId && issue.projectName) meta.project = { id: issue.projectId, name: issue.projectName };
  if (issue.milestoneId && issue.milestoneName) meta.milestone = { id: issue.milestoneId, name: issue.milestoneName };
  return meta;
}

/** Inverse of `JSON.stringify(buildExternalMeta(...))` — the read side the roadmap payload (and
 *  its client canvas) parses once, defensively: absent or malformed JSON (a non-Linear card, or a
 *  row written before this column existed) becomes `null` rather than throwing. */
export function parseExternalMeta(raw: string | null | undefined): ExternalMeta | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ExternalMeta;
  } catch {
    return null;
  }
}

// No `layer` here — Linear has no layer, and a pure-backend workspace must never carry one
// (AGENTS.md). The executor sets layer only when the workspace has a frontend.
export function issueToNodeFields(issue: LinearIssue): NodeFields {
  return {
    title: issue.title,
    plain: issue.description ?? null,
    status: linearStateToStatus(issue.stateType),
    priority: linearPriorityToBeacon(issue.priority),
    kind: issue.labels.some((l) => l.toLowerCase() === "bug") ? "BUG" : "FEATURE",
    cluster: issue.projectName ?? issue.teamKey,
    source: "LINEAR",
    externalId: issue.id,
    sourceRef: issue.url,
    assigneeName: issue.assigneeName ?? null,
    assigneeAvatarUrl: issue.assigneeAvatarUrl ?? null,
    externalMeta: JSON.stringify(buildExternalMeta(issue)),
  };
}
