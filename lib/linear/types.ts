// Shared shapes for the Linear ↔ Beacon sync. The GraphQL client flattens Linear's nested issue
// response into this flat LinearIssue (updatedAt as epoch-ms, not ISO) so the pure mapping +
// reconcile layers never touch the wire format.

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
  stateName: string; // real workflow-state name, e.g. "In Review" — persisted for display/filtering
  stateColor: string; // workflow-state color, e.g. "#0f783c"
  labels: string[];
  parentId?: string | null;
  teamId: string; // used to resolve that team's workflow states for write-back
  teamKey: string;
  teamName: string;
  projectId?: string | null;
  projectName?: string | null;
  milestoneId?: string | null;
  milestoneName?: string | null;
  assigneeName?: string | null; // owner-avatar chip
  assigneeAvatarUrl?: string | null;
}

/**
 * A team, project, milestone, or the entire workspace the board is scoped to (before the optional
 * assignee filter) — any mix of these may be combined (see `effectiveScopes`). `projectName` is set
 * only for milestones (display: "name · projectName"); a `workspace` scope always uses
 * `id: "workspace"` and `name: <orgName>`.
 */
export interface LinearScope {
  kind: "team" | "project" | "milestone" | "workspace";
  id: string;
  name: string;
  projectName?: string;
}

/** Per-workspace Linear connection, stored in WorkspaceFlag(key="linear").config as JSON. */
export interface LinearConfig {
  apiKey: string;
  orgName?: string;
  orgUrlKey?: string;
  viewerId?: string;
  viewerName?: string;
  /** @deprecated single-scope legacy field — kept for back-compat reads only. Use `scopes`. */
  scope?: LinearScope;
  /** Any mix of teams/projects/milestones, or a single `workspace` scope. Wins over `scope` once set. */
  scopes?: LinearScope[];
  onlyMine?: boolean; // narrow the scope to issues assigned to the viewer
  lastSyncedAt?: string; // ISO of the last successful reconcile (UI only)
  /** Beacon status → Linear state UUID, per team (states are per-team; scope can span teams). */
  stateMapByTeam?: Record<string, Partial<Record<NodeStatus, string>>>;
}

/** All readers go through this — never read `config.scope` / `config.scopes` directly. */
export function effectiveScopes(config: Pick<LinearConfig, "scope" | "scopes"> | null | undefined): LinearScope[] {
  if (!config) return [];
  return config.scopes ?? (config.scope ? [config.scope] : []);
}
