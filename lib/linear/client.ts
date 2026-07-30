// Thin Linear GraphQL client. Personal-API-key auth (Authorization: <key> → api.linear.app), the
// only auth a localhost daemon can do (no OAuth callback). ponytail: the raw fetch wrapper is not
// unit-tested (testing it would test the mock); the one non-trivial pure bit — flattenIssue — is
// (tests/linear-client.test.ts).
import type { LinearIssue, LinearScope, LinearWorkflowState, NodeStatus } from "@/lib/linear/types";

const ENDPOINT = "https://api.linear.app/graphql";

interface RawIssue {
  id: string;
  identifier: string;
  url: string;
  title: string;
  description: string | null;
  updatedAt: string; // ISO
  priority: number;
  state: { id: string; name: string; color: string; type: string };
  labels: { nodes: { name: string }[] };
  parent: { id: string } | null;
  team: { id: string; key: string; name: string };
  project: { id: string; name: string } | null;
  projectMilestone: { id: string; name: string } | null;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
}

export const ISSUE_FIELDS = `
  id identifier url title description updatedAt priority
  state { id name color type }
  labels { nodes { name } }
  parent { id }
  team { id key name }
  project { id name }
  projectMilestone { id name }
  assignee { id name avatarUrl }
`;

export function flattenIssue(raw: RawIssue): LinearIssue {
  return {
    id: raw.id,
    identifier: raw.identifier,
    url: raw.url,
    title: raw.title,
    description: raw.description,
    updatedAt: Date.parse(raw.updatedAt),
    priority: raw.priority,
    stateId: raw.state.id,
    stateType: raw.state.type,
    stateName: raw.state.name,
    stateColor: raw.state.color,
    labels: raw.labels.nodes.map((l) => l.name),
    parentId: raw.parent?.id ?? null,
    teamId: raw.team.id,
    teamKey: raw.team.key,
    teamName: raw.team.name,
    projectId: raw.project?.id ?? null,
    projectName: raw.project?.name ?? null,
    milestoneId: raw.projectMilestone?.id ?? null,
    milestoneName: raw.projectMilestone?.name ?? null,
    assigneeName: raw.assignee?.name ?? null,
    assigneeAvatarUrl: raw.assignee?.avatarUrl ?? null,
  };
}

async function gql<T>(apiKey: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: apiKey },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Linear API ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`Linear GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
  if (!json.data) throw new Error("Linear GraphQL: empty response");
  return json.data;
}

export interface ViewerOrg {
  viewerId: string;
  viewerName: string;
  orgName: string;
  orgUrlKey: string;
}

/** Resolve who the key authenticates as + which workspace it's bound to (validates the key). */
export async function resolveViewerAndOrg(apiKey: string): Promise<ViewerOrg> {
  const d = await gql<{
    viewer: { id: string; name: string };
    organization: { name: string; urlKey: string };
  }>(apiKey, `query { viewer { id name } organization { name urlKey } }`);
  return {
    viewerId: d.viewer.id,
    viewerName: d.viewer.name,
    orgName: d.organization.name,
    orgUrlKey: d.organization.urlKey,
  };
}

/** Page a top-level `teams`/`projects` connection to completion (default page size is only ~50). */
async function pageAllNamed(apiKey: string, field: "teams" | "projects"): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let after: string | undefined;
  for (let page = 0; page < 50; page++) {
    const d = await gql<Record<string, { nodes: { id: string; name: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string } }>>(
      apiKey,
      `query($after: String) { ${field}(first: 250, after: $after) { nodes { id name } pageInfo { hasNextPage endCursor } } }`,
      { after },
    );
    out.push(...d[field].nodes);
    if (!d[field].pageInfo.hasNextPage) break;
    after = d[field].pageInfo.endCursor;
  }
  return out;
}

/** Page `projectMilestones` to completion — same shape as `pageAllNamed` but needs `project { name }`. */
async function pageAllMilestones(apiKey: string): Promise<{ id: string; name: string; projectName: string }[]> {
  const out: { id: string; name: string; projectName: string }[] = [];
  let after: string | undefined;
  for (let page = 0; page < 50; page++) {
    const d = await gql<{
      projectMilestones: {
        nodes: { id: string; name: string; project: { name: string } }[];
        pageInfo: { hasNextPage: boolean; endCursor: string };
      };
    }>(
      apiKey,
      `query($after: String) { projectMilestones(first: 250, after: $after) { nodes { id name project { name } } pageInfo { hasNextPage endCursor } } }`,
      { after },
    );
    out.push(...d.projectMilestones.nodes.map((n) => ({ id: n.id, name: n.name, projectName: n.project.name })));
    if (!d.projectMilestones.pageInfo.hasNextPage) break;
    after = d.projectMilestones.pageInfo.endCursor;
  }
  return out;
}

/** Teams + projects + milestones in the workspace, for the multi-scope picker (paginated). */
export async function listScopes(apiKey: string): Promise<LinearScope[]> {
  const [teams, projects, milestones] = await Promise.all([
    pageAllNamed(apiKey, "teams"),
    pageAllNamed(apiKey, "projects"),
    pageAllMilestones(apiKey),
  ]);
  return [
    ...teams.map((t) => ({ kind: "team" as const, id: t.id, name: t.name })),
    ...projects.map((p) => ({ kind: "project" as const, id: p.id, name: p.name })),
    ...milestones.map((m) => ({ kind: "milestone" as const, id: m.id, name: m.name, projectName: m.projectName })),
  ];
}

/** Every workflow state a team defines, in the team's own order. Two consumers: the Status picker
 *  on a Linear card renders them verbatim, and `stateMapFromStates` collapses them into the
 *  Beacon-status map the write-back path needs — ONE query serving both. */
export async function fetchTeamStates(apiKey: string, teamId: string): Promise<LinearWorkflowState[]> {
  const d = await gql<{
    team: { states: { nodes: { id: string; name: string; color: string; type: string; position: number }[] } };
  }>(
    apiKey,
    `query($teamId: String!) { team(id: $teamId) { states { nodes { id name color type position } } } }`,
    { teamId },
  );
  return sortWorkflowStates(d.team.states.nodes);
}

// Linear's own menu groups states BY TYPE first, then by position within the type — `position` alone
// is not the order the user sees. Observed on a real team: In Review sits at position 1002 yet
// Linear lists it 4th, right after In Progress, because both are `started`.
//
// This table is ORDERING ONLY and deliberately NOT authoritative. State NAMES are whatever the
// team invented and are never hardcoded anywhere — that is the entire point of the vocabulary.
// TYPES come from Linear's own enum, but we don't assume this list is complete (`duplicate` was
// found on a real team and isn't in the public docs): an unrecognised type sorts last and keeps its
// relative position, so a state Beacon has never heard of still appears in the picker.
const TYPE_RANK: Record<string, number> = {
  triage: 0,
  backlog: 1,
  unstarted: 2,
  started: 3,
  completed: 4,
  canceled: 5,
  duplicate: 6,
};

/** PURE — the states in the order Linear itself shows them. Unknown types sort last, stably. */
export function sortWorkflowStates(states: LinearWorkflowState[]): LinearWorkflowState[] {
  const rank = (s: LinearWorkflowState) => TYPE_RANK[s.type] ?? 99;
  return [...states].sort((a, b) => rank(a) - rank(b) || a.position - b.position);
}

/** PURE — map each Beacon status to a concrete state UUID (write-back needs it). Unit-tested. */
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

/** Map each Beacon status to a concrete Linear workflow-state UUID for a team. */
export async function resolveStateMap(
  apiKey: string,
  teamId: string,
): Promise<Partial<Record<NodeStatus, string>>> {
  return stateMapFromStates(await fetchTeamStates(apiKey, teamId));
}

/**
 * The FULL current scoped set: open issues (not completed/canceled) in ANY of the given
 * teams/projects/milestones (or the whole workspace), optionally narrowed to assignee=viewer.
 * Pages to completion — the scoped/assigned set is small, and this is what lets the reconcile
 * detect issues that LEFT the scope.
 */
export interface ScopedFetch {
  issues: LinearIssue[];
  /** false when the page cap truncated the set — the caller must NOT treat "absent" as "removed". */
  complete: boolean;
}

/**
 * PURE — builds the IssueFilter for any mix of team/project/milestone scopes (or the whole
 * workspace). Extracted so it unit-tests without the network (tests/linear-client.test.ts).
 * A `workspace` scope short-circuits to no container constraint at all. Otherwise each present
 * kind becomes one `in`-comparator branch of an `or`, so the fetch is a single paged query with
 * no client-side merge/dedup needed.
 *
 * `ids` flips it to the CLOSED-ISSUE probe: the state exclusion is dropped and the set is pinned to
 * those issue ids. The scope constraint STAYS, which is the whole point — it tells "finished, still
 * ours" (comes back → the card goes Done) apart from "left the scope" (doesn't → the card hides).
 */
export function buildIssueFilter(
  scopes: LinearScope[],
  onlyMineViewerId?: string,
  ids?: string[],
): Record<string, unknown> {
  const filter: Record<string, unknown> = ids
    ? { id: { in: ids } }
    : { state: { type: { nin: ["completed", "canceled"] } } };
  if (onlyMineViewerId) filter.assignee = { id: { eq: onlyMineViewerId } };

  if (!scopes.some((s) => s.kind === "workspace")) {
    const idsOf = (kind: LinearScope["kind"]) => scopes.filter((s) => s.kind === kind).map((s) => s.id);
    const teamIds = idsOf("team");
    const projectIds = idsOf("project");
    const milestoneIds = idsOf("milestone");
    const or: Record<string, unknown>[] = [];
    if (teamIds.length) or.push({ team: { id: { in: teamIds } } });
    if (projectIds.length) or.push({ project: { id: { in: projectIds } } });
    if (milestoneIds.length) or.push({ projectMilestone: { id: { in: milestoneIds } } });
    if (or.length) filter.or = or;
  }
  return filter;
}

export async function fetchScopedOpenIssues(
  apiKey: string,
  scopes: LinearScope[],
  opts: { onlyMineViewerId?: string } = {},
): Promise<ScopedFetch> {
  return fetchByFilter(apiKey, buildIssueFilter(scopes, opts.onlyMineViewerId));
}

/**
 * The issues among `ids` that are STILL IN SCOPE, closed ones included. Its only caller is the
 * reconcile: a tracked card missing from the open set is either finished or gone, and hiding both
 * is what made a completed sub-issue disappear off the board instead of landing in Done. Bounded to
 * ids Beacon already tracks, so a repo's closed-issue history can never flood in.
 */
export async function fetchScopedIssuesByIds(
  apiKey: string,
  scopes: LinearScope[],
  ids: string[],
  opts: { onlyMineViewerId?: string } = {},
): Promise<LinearIssue[]> {
  if (ids.length === 0) return [];
  const { issues } = await fetchByFilter(apiKey, buildIssueFilter(scopes, opts.onlyMineViewerId, ids));
  return issues;
}

async function fetchByFilter(apiKey: string, filter: Record<string, unknown>): Promise<ScopedFetch> {
  const query = `
    query($filter: IssueFilter, $after: String) {
      issues(filter: $filter, first: 100, after: $after) {
        nodes { ${ISSUE_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }`;
  const out: LinearIssue[] = [];
  let after: string | undefined;
  // Page to completion. The 500-page backstop only guards a pathological pull; on hitting it we
  // report complete:false so the reconcile skips removals (a truncated set is not authoritative).
  for (let page = 0; page < 500; page++) {
    const d = await gql<{
      issues: { nodes: RawIssue[]; pageInfo: { hasNextPage: boolean; endCursor: string } };
    }>(apiKey, query, { filter, after });
    out.push(...d.issues.nodes.map(flattenIssue));
    if (!d.issues.pageInfo.hasNextPage) return { issues: out, complete: true };
    after = d.issues.pageInfo.endCursor;
  }
  console.warn("[beacon-linear] scoped issue set exceeded 500 pages; skipping removals this pass");
  return { issues: out, complete: false };
}

export interface IssuePatch {
  title?: string;
  description?: string | null;
  priority?: number;
  stateId?: string;
}

/** Write-back one issue; returns the new updatedAt (ms) so the caller can advance markers. */
export async function updateIssue(apiKey: string, id: string, patch: IssuePatch): Promise<number> {
  const d = await gql<{ issueUpdate: { success: boolean; issue: { updatedAt: string } } }>(
    apiKey,
    `mutation($id: String!, $input: IssueUpdateInput!) {
       issueUpdate(id: $id, input: $input) { success issue { updatedAt } }
     }`,
    { id, input: patch },
  );
  return Date.parse(d.issueUpdate.issue.updatedAt);
}
