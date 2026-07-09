// Thin Linear GraphQL client. Personal-API-key auth (Authorization: <key> → api.linear.app), the
// only auth a localhost daemon can do (no OAuth callback). ponytail: the raw fetch wrapper is not
// unit-tested (testing it would test the mock); the one non-trivial pure bit — flattenIssue — is
// (tests/linear-client.test.ts).
import type { LinearIssue, LinearScope, NodeStatus } from "@/lib/linear/types";

const ENDPOINT = "https://api.linear.app/graphql";

interface RawIssue {
  id: string;
  identifier: string;
  url: string;
  title: string;
  description: string | null;
  updatedAt: string; // ISO
  priority: number;
  state: { name: string; color: string; type: string };
  labels: { nodes: { name: string }[] };
  parent: { id: string } | null;
  team: { id: string; key: string; name: string };
  project: { id: string; name: string } | null;
  projectMilestone: { id: string; name: string } | null;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
}

export const ISSUE_FIELDS = `
  id identifier url title description updatedAt priority
  state { name color type }
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

/** Map each Beacon status to a concrete Linear workflow-state UUID for a team (write-back needs it). */
export async function resolveStateMap(
  apiKey: string,
  teamId: string,
): Promise<Partial<Record<NodeStatus, string>>> {
  const d = await gql<{ team: { states: { nodes: { id: string; type: string }[] } } }>(
    apiKey,
    `query($teamId: String!) { team(id: $teamId) { states { nodes { id type } } } }`,
    { teamId },
  );
  const first = (type: string) => d.team.states.nodes.find((s) => s.type === type)?.id;
  const map: Partial<Record<NodeStatus, string>> = {};
  const done = first("completed");
  const cancelled = first("canceled");
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
 */
export function buildIssueFilter(scopes: LinearScope[], onlyMineViewerId?: string): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    state: { type: { nin: ["completed", "canceled"] } },
  };
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
  const filter = buildIssueFilter(scopes, opts.onlyMineViewerId);

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
