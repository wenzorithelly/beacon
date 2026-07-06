// Pure Linear ↔ Beacon field maps. No I/O, no db — exhaustively unit-tested
// (tests/linear-mapping.test.ts) because this is where a wrong status/priority silently
// corrupts the board.
import type { LinearIssue, NodeStatus } from "@/lib/linear/types";

const STATE_TYPE_TO_STATUS: Record<string, NodeStatus> = {
  completed: "DONE",
  canceled: "CANCELLED",
  started: "IN_PROGRESS",
  backlog: "PENDING",
  unstarted: "PENDING",
  triage: "PENDING",
};

export function linearStateToStatus(stateType: string): NodeStatus {
  return STATE_TYPE_TO_STATUS[stateType] ?? "PENDING";
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
  };
}
