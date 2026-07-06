// Shared shapes for the Linear ↔ Beacon sync. The GraphQL client flattens Linear's
// nested issue response into this flat LinearIssue (updatedAt as epoch-ms, not ISO) so the
// pure mapping + reconcile layers never touch the wire format.

export type NodeStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "BLOCKED" | "CANCELLED";

export interface LinearIssue {
  id: string; // stable UUID — the key for issueUpdate write-back + node.externalId
  identifier: string; // e.g. "V3-339"
  url: string;
  title: string;
  description?: string | null;
  updatedAt: number; // epoch-ms (client converts Linear's ISO string)
  priority: number; // Linear 0=None,1=Urgent,2=High,3=Medium,4=Low
  stateType: string; // triage|backlog|unstarted|started|completed|canceled
  labels: string[];
  parentId?: string | null;
  teamKey: string;
  projectName?: string | null;
}

/** Per-workspace connection, stored in WorkspaceFlag(key="linear").config as JSON. */
export interface LinearConfig {
  apiKey: string;
  teamId: string;
  teamKey?: string;
  orgUrlKey?: string;
  lastCursor?: string; // ISO of the newest issue.updatedAt reconciled
  /** Beacon status → Linear workflow-state UUID, resolved once from the team's states. */
  stateMap?: Partial<Record<NodeStatus, string>>;
}
