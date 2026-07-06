// Thin Linear GraphQL client. Personal-API-key auth (Authorization: <key> → api.linear.app),
// the only auth a localhost daemon can do (no OAuth callback). ponytail: the raw fetch wrapper is
// not unit-tested (testing it would test the mock); the one non-trivial pure bit — flattenIssue —
// is (tests/linear-client.test.ts).
import type { LinearIssue, NodeStatus } from "@/lib/linear/types";

const ENDPOINT = "https://api.linear.app/graphql";

interface RawIssue {
  id: string;
  identifier: string;
  url: string;
  title: string;
  description: string | null;
  updatedAt: string; // ISO
  priority: number;
  state: { type: string };
  labels: { nodes: { name: string }[] };
  parent: { id: string } | null;
  team: { key: string };
  project: { name: string } | null;
}

const ISSUE_FIELDS = `
  id identifier url title description updatedAt priority
  state { type }
  labels { nodes { name } }
  parent { id }
  team { key }
  project { name }
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
    labels: raw.labels.nodes.map((l) => l.name),
    parentId: raw.parent?.id ?? null,
    teamKey: raw.team.key,
    projectName: raw.project?.name ?? null,
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

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
}

export async function listTeams(apiKey: string): Promise<LinearTeam[]> {
  const d = await gql<{ teams: { nodes: LinearTeam[] } }>(apiKey, `query { teams { nodes { id key name } } }`);
  return d.teams.nodes;
}

/** Map each Beacon status to a concrete Linear workflow-state UUID for this team (write-back needs it). */
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
  return map;
}

/** Delta pull: issues in the team changed since `sinceISO` (all of them on first sync). */
export async function fetchIssuesSince(
  apiKey: string,
  teamId: string,
  sinceISO?: string,
): Promise<LinearIssue[]> {
  const filter: Record<string, unknown> = { team: { id: { eq: teamId } } };
  if (sinceISO) filter.updatedAt = { gt: sinceISO };
  const query = `
    query($filter: IssueFilter, $after: String) {
      issues(filter: $filter, orderBy: updatedAt, first: 100, after: $after) {
        nodes { ${ISSUE_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }`;
  const out: LinearIssue[] = [];
  let after: string | undefined;
  // Page through the ENTIRE filtered set (updatedAt > cursor). Stopping early would strand every
  // issue past the cap forever — the cursor advances to the newest fetched, so `gt cursor` never
  // returns the older ones again. The 500-page backstop only guards a pathological/mis-cursored
  // pull; hitting it is logged, never a silent drop.
  for (let page = 0; page < 500; page++) {
    const d = await gql<{
      issues: { nodes: RawIssue[]; pageInfo: { hasNextPage: boolean; endCursor: string } };
    }>(apiKey, query, { filter, after });
    out.push(...d.issues.nodes.map(flattenIssue));
    if (!d.issues.pageInfo.hasNextPage) return out;
    after = d.issues.pageInfo.endCursor;
  }
  console.warn("[beacon-linear] issue delta exceeded 500 pages (~50k issues); truncated this pass");
  return out;
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
