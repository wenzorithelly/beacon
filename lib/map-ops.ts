import { z } from "zod";
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db-drizzle";
import { node, nodeFile, edge, appSetting, bugFlag } from "@/lib/drizzle/schema";
import { bumpVersion } from "@/lib/ingest";
import { prunePlannedEntities } from "@/lib/plan-lineage";
import { matchFeature, type Scored } from "@/lib/match";
import { validateFeatureCreation, validateFront } from "@/lib/feature-rules";
import { normalizeLayer } from "@/lib/layer";
import { resolveHasFrontend } from "@/lib/project-meta";
import { placeInGroup, placeWithoutOverlap } from "@/lib/node-placement";
import { layoutRoadmap, type RoadmapGroupBy } from "@/lib/roadmap-layout";
import { layeredLayout } from "@/lib/layered-layout";
import {
  BOARD_ALGO_VERSIONS,
  readBoardLayout,
  writeBoardLayout,
  type BoardKey,
} from "@/lib/board-layout-state";
import { createNode } from "@/lib/mutations";
import { repoRoot } from "@/lib/project";
import { setAppSettings } from "@/lib/settings";

async function setCurrent(id: string) {
  await setAppSettings({ currentFeatureId: id });
}

// Map write operations used by the HTTP API + the MCP server. Lets a Claude Code
// session see the roadmap and register what it's working on: flag an existing
// feature as "being worked on", or add a new one under the right front (or a new front).

export interface MapView {
  fronts: Array<{
    id: string;
    title: string;
    status: string;
    tasks: Array<{ id: string; title: string; status: string; workingOn: boolean }>;
  }>;
}

export async function listMap(): Promise<MapView> {
  const nodes = await db.query.node.findMany({
    where: (t, { eq }) => eq(t.view, "ROADMAP"),
    orderBy: (t, { asc }) => asc(t.createdAt),
  });
  const fronts = nodes.filter((n) => !n.parentId);
  return {
    fronts: fronts.map((f) => ({
      id: f.id,
      title: f.title,
      status: f.status,
      tasks: nodes
        .filter((n) => n.parentId === f.id)
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          workingOn: t.status === "IN_PROGRESS",
        })),
    })),
  };
}

export type StartResult =
  | { action: "flagged"; id: string; title: string; via: "id" | "match"; score?: number }
  | { action: "created"; id: string; title: string; front: string | null }
  | { action: "ambiguous"; candidates: Scored[] }
  | { action: "rejected"; message: string };

async function setStatus(id: string, status: string) {
  await db.update(node).set({ status }).where(eq(node.id, id));
  await propagateStatusUp(id);
  await bumpVersion();
}

// ── Parent-derived status propagation ───────────────────────────────────────
// When a roadmap child's status changes, walk up the parent chain so each
// ancestor reflects its children's reality. Status doesn't auto-update from
// progress because the canvas needs the explicit field to colour/sort by.
//
// Status classes for the derivation:
//   complete   — DONE, CANCELLED, DEPRIORITIZED (off the board, count as "settled")
//   active     — IN_PROGRESS, BLOCKED
//   pending    — PENDING (default)
//
// Rules (only applied to ROADMAP nodes):
//   • all children complete → parent DONE
//   • any child active      → parent IN_PROGRESS
//   • else                  → parent PENDING
//
// Sticky parent states (CANCELLED, DEPRIORITIZED) are user decisions and win —
// nothing children do will override them. Unmark them to re-enable derivation.

const COMPLETE_STATUSES = new Set(["DONE", "CANCELLED", "DEPRIORITIZED"]);
const ACTIVE_STATUSES = new Set(["IN_PROGRESS", "BLOCKED"]);
const STICKY_PARENT_STATUSES = new Set(["CANCELLED", "DEPRIORITIZED"]);

function deriveParentStatus(childStatuses: string[]): string {
  if (!childStatuses.length) return "PENDING";
  if (childStatuses.every((s) => COMPLETE_STATUSES.has(s))) return "DONE";
  if (childStatuses.some((s) => ACTIVE_STATUSES.has(s))) return "IN_PROGRESS";
  return "PENDING";
}

/**
 * Recompute the parent of `nodeId` (and onwards up) from its children's
 * statuses. No-op for top-level nodes, ARCHITECTURE-view nodes, or when the
 * parent has a sticky user-set status. Safe to call after any roadmap-node
 * status write; idempotent.
 */
export async function propagateStatusUp(nodeId: string): Promise<void> {
  // Climb the parent chain iteratively. The `seen` guard means a corrupt parentId CYCLE
  // (an ancestor pointing back to a descendant) terminates instead of recursing forever —
  // an unbounded climb here would peg the event loop and hang every request.
  const seen = new Set<string>();
  let id = nodeId;
  while (!seen.has(id)) {
    seen.add(id);
    const self = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.id, id),
      columns: { parentId: true, view: true },
    });
    if (!self?.parentId || self.view !== "ROADMAP") return;

    const parent = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.id, self.parentId!),
      columns: { id: true, status: true, view: true },
    });
    if (!parent || parent.view !== "ROADMAP") return;
    if (STICKY_PARENT_STATUSES.has(parent.status)) return;

    const siblings = await db.query.node.findMany({
      where: (t, { eq }) => eq(t.parentId, parent.id),
      columns: { status: true },
    });
    const derived = deriveParentStatus(siblings.map((s) => s.status));
    if (parent.status === derived) return;

    await db.update(node).set({ status: derived }).where(eq(node.id, parent.id));
    id = parent.id; // climb and continue
  }
}

// ── Completion cascade (Done feature → its sub-tasks) ───────────────────────
// Registering a feature DONE asserts its work is finished — so its unfinished
// descendant sub-tasks flip DONE too, instead of stranding a Done parent over
// Pending children the agent actually completed (which reads as "unknown state"
// on the board). User decisions stay sticky: CANCELLED / DEPRIORITIZED are
// already settled, and BLOCKED stays visible as a deliberate alarm — it's
// returned to the caller so the agent can surface it.

const CASCADE_STATUSES = new Set(["PENDING", "IN_PROGRESS"]);

export async function cascadeCompletionDown(featureId: string): Promise<{
  completed: number;
  blocked: Array<{ id: string; title: string; status: string }>;
}> {
  const toComplete: string[] = [];
  const blocked: Array<{ id: string; title: string; status: string }> = [];
  // Breadth-first over ROADMAP descendants; the `seen` guard terminates on a
  // corrupt parentId cycle, mirroring propagateStatusUp.
  const seen = new Set<string>([featureId]);
  let frontier = [featureId];
  while (frontier.length) {
    const children = await db.query.node.findMany({
      where: (t, { and, eq, inArray: inArr }) =>
        and(inArr(t.parentId, frontier), eq(t.view, "ROADMAP")),
      columns: { id: true, title: true, status: true },
    });
    frontier = [];
    for (const c of children) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      frontier.push(c.id);
      if (CASCADE_STATUSES.has(c.status)) toComplete.push(c.id);
      else if (c.status === "BLOCKED") blocked.push(c);
    }
  }
  if (toComplete.length)
    await db.update(node).set({ status: "DONE" }).where(inArray(node.id, toComplete));
  return { completed: toComplete.length, blocked };
}

/**
 * A session starts working on a feature. Resolution order:
 *  1. explicit `id` (from beacon_map) → flag it (100% reliable)
 *  2. confident, unambiguous fuzzy match → flag it
 *  3. plausible-but-ambiguous matches → return candidates to disambiguate
 *  4. no match → create it under `front` (creating that front if needed)
 */
// Organized by default: arrange a board into labeled groups (roadmap → theme lanes,
// architecture → domain clusters) AT MOST ONCE per layout-algo version. Called on every /map
// load; the per-workspace sig file gates it, so after the one-shot the board belongs to the
// user — refreshes, drags and structural changes never trigger a full re-layout again (new
// nodes are placed incrementally inside their group via placeInGroup). Only an algo-version
// bump (ships a re-tidy to every workspace once) or an explicit Group-by/Arrange click moves
// existing cards. DRAFT nodes are excluded (a plan under review owns its own layout). Does
// NOT bump the sync version.
export async function ensureBoardArranged(view: "ROADMAP" | "ARCHITECTURE"): Promise<void> {
  const board: BoardKey = view === "ROADMAP" ? "roadmap" : "architecture";
  const version = BOARD_ALGO_VERSIONS[board];
  const stored = readBoardLayout(board);
  if (stored.sig === version) return; // one-shot already done for this algo
  const all = await db.query.node.findMany({
    where: (t, { eq }) => eq(t.view, view),
    orderBy: (t, { asc }) => asc(t.createdAt),
    columns: { id: true, parentId: true, source: true, cluster: true, layer: true, status: true, priority: true, x: true, y: true },
  });
  const nodes = all.filter((n) => n.source !== "DRAFT");
  // Nothing worth arranging yet — don't burn the one-shot, so the board still tidies itself
  // the first time it actually has content (e.g. right after /beacon-init).
  if (nodes.length < 2) return;

  let pos: Map<string, { x: number; y: number }>;
  let arrangedBy: string | null = null;
  if (view === "ROADMAP") {
    const by: RoadmapGroupBy =
      stored.arrangedBy === "status" || stored.arrangedBy === "priority" || stored.arrangedBy === "layer"
        ? stored.arrangedBy
        : "cluster";
    arrangedBy = by;
    pos = layoutRoadmap(
      nodes.map((n) => ({
        id: n.id,
        parentId: n.parentId,
        cluster: n.cluster,
        layer: n.layer,
        status: n.status,
        priority: n.priority,
      })),
      by,
    );
  } else {
    // Layered dependency flow: foundations left, dependents rightward, domains as bands.
    const ids = nodes.map((n) => n.id);
    const depends = await db.query.edge.findMany({
      where: (t, { and: a, eq: q }) =>
        a(q(t.kind, "DEPENDS"), inArray(t.fromId, ids), inArray(t.toId, ids)),
      columns: { fromId: true, toId: true },
    });
    pos = layeredLayout(
      nodes.map((n) => ({ id: n.id, group: (n.cluster ?? "").trim() || "—" })),
      depends,
    );
  }

  const updates: Promise<unknown>[] = [];
  for (const n of nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    if (Math.round(p.x) === Math.round(n.x) && Math.round(p.y) === Math.round(n.y)) continue;
    updates.push(db.update(node).set({ x: p.x, y: p.y }).where(eq(node.id, n.id)));
  }
  await Promise.all(updates);
  writeBoardLayout(board, arrangedBy ? { sig: version, arrangedBy } : { sig: version });
}

export async function startFeature(input: {
  title: string;
  id?: string | null;
  front?: string | null;
  detail?: string | null;
  cluster?: string | null;
  /** FEATURE (default) | BUG — only used when the call CREATES a new node. */
  kind?: string | null;
  /** frontend | backend | fullstack — only used when the call CREATES a new node;
   *  a sub-task nested under a front inherits the front's layer. */
  layer?: string | null;
}): Promise<StartResult> {
  const title = input.title.trim();
  if (!title) throw new Error("title required");

  const nodes = await db.query.node.findMany({ where: (t, { eq }) => eq(t.view, "ROADMAP") });

  if (input.id) {
    const n = nodes.find((x) => x.id === input.id);
    if (n) {
      await setStatus(n.id, "IN_PROGRESS");
      await setCurrent(n.id);
      return { action: "flagged", id: n.id, title: n.title, via: "id" };
    }
  }

  const { best, candidates } = matchFeature(
    title,
    nodes.map((n) => ({ id: n.id, title: n.title })),
  );
  if (best) {
    await setStatus(best.id, "IN_PROGRESS");
    await setCurrent(best.id);
    return { action: "flagged", id: best.id, title: best.title, via: "match", score: best.score };
  }
  if (candidates.length) return { action: "ambiguous", candidates };

  // No match → create. Guard the loose path the same way propose_plan is guarded: a `front`
  // must reference a REAL existing parent feature (not a domain tag — that footgun is how a bogus
  // "CRAWL" front got created), and a brand-new top-level feature must carry a category. A task
  // nested under a front inherits the front's category. Shares lib/feature-rules with the plan path.
  const fronts = nodes.filter((n) => !n.parentId);
  const frontInput = input.front?.trim() || "";

  const frontErr = frontInput
    ? validateFront(frontInput, fronts.map((n) => ({ id: n.id, title: n.title })))
    : null;
  if (frontErr) return { action: "rejected", message: frontErr };

  let parentId: string | null = null;
  let frontTitle: string | null = null;
  let inheritedCluster: string | null = null;
  let inheritedLayer: string | null = null;
  if (frontInput) {
    const f = matchFeature(frontInput, fronts.map((n) => ({ id: n.id, title: n.title }))).best!;
    parentId = f.id;
    frontTitle = f.title;
    const front = nodes.find((n) => n.id === f.id);
    inheritedCluster = front?.cluster ?? null;
    inheritedLayer = front?.layer ?? null;
  }

  const cluster = (input.cluster?.trim() || inheritedCluster) ?? null;
  const layer = normalizeLayer(input.layer) ?? normalizeLayer(inheritedLayer);
  // Layer is only demanded of NEW top-level features, and only in workspaces that have a
  // frontend — a sub-task inherits its front's layer, a pure-backend repo never needs one.
  const requireLayer = !parentId && (await resolveHasFrontend());
  const createErr = validateFeatureCreation({
    title,
    category: cluster,
    layer,
    requireLayer,
    existing: nodes.map((n) => ({ id: n.id, title: n.title, cluster: n.cluster, status: n.status })),
  });
  if (createErr) return { action: "rejected", message: createErr };

  // Sub-tasks stack under their parent; a new top-level feature lands INSIDE its theme's
  // region (shortest masonry column) instead of a blind row — the board stays organized
  // without a full re-layout.
  const siblings = parentId ? nodes.filter((n) => n.parentId === parentId).length : 0;
  const groupKey = (c: string | null) => (c ?? "").trim() || "—";
  const pos = parentId
    ? placeWithoutOverlap(
        nodes.map((n) => ({ x: n.x, y: n.y })),
        {
          x: fronts.find((f) => f.id === parentId)?.x ?? 0,
          y: 160 + siblings * 110,
        },
      )
    : placeInGroup(
        nodes
          .filter((n) => !n.parentId && groupKey(n.cluster) === groupKey(cluster))
          .map((n) => ({ x: n.x, y: n.y })),
        nodes.map((n) => ({ x: n.x, y: n.y })),
      );
  const [task] = await db
    .insert(node)
    .values({
      view: "ROADMAP",
      kind: input.kind?.trim().toUpperCase() === "BUG" ? "BUG" : "FEATURE",
      title,
      plain: input.detail ?? null,
      cluster,
      layer,
      status: "IN_PROGRESS",
      source: "SESSION",
      parentId,
      x: pos.x,
      y: pos.y,
    })
    .returning();
  await propagateStatusUp(task.id);
  await bumpVersion();
  await setCurrent(task.id);
  return { action: "created", id: task.id, title, front: frontTitle };
}

export async function finishFeature(input: {
  title?: string;
  id?: string;
}): Promise<{
  ok: boolean;
  id?: string;
  candidates?: Scored[];
  subtasksCompleted?: number;
  subtasksBlocked?: Array<{ id: string; title: string; status: string }>;
}> {
  const nodes = await db.query.node.findMany({ where: (t, { eq }) => eq(t.view, "ROADMAP") });

  const finish = async (id: string) => {
    const cascade = await cascadeCompletionDown(id);
    await setStatus(id, "DONE");
    // The feature shipped — drop planned tables/endpoints of plans no longer in flight.
    await prunePlannedEntities();
    return {
      ok: true as const,
      id,
      subtasksCompleted: cascade.completed || undefined,
      subtasksBlocked: cascade.blocked.length ? cascade.blocked : undefined,
    };
  };

  if (input.id) {
    const n = nodes.find((x) => x.id === input.id);
    if (n) return finish(n.id);
  }
  if (!input.title) return { ok: false };

  const { best, candidates } = matchFeature(
    input.title,
    nodes.map((n) => ({ id: n.id, title: n.title })),
  );
  if (best) return finish(best.id);
  return { ok: false, candidates: candidates.length ? candidates : undefined };
}

// Make a reported path repo-relative (paths come from a session's cwd).
function normalizePath(p: string): string {
  let s = p.trim();
  const root = repoRoot();
  if (s.startsWith(root)) s = s.slice(root.length);
  return s.replace(/^[./]+/, "").trim();
}

// ── Architecture components (curated) ───────────────────────────────────────
// Deliberate upsert of REAL architectural components — the curated replacement for the old
// per-file auto-derivation. Upserts by title (case-insensitive): existing nodes keep their
// position; new ones land in their domain's column, stacked below any existing siblings.
// New nodes are source="MANUAL" so a future /beacon-init (which only replaces source="INIT")
// never clobbers them. This NEVER creates one-node-per-file — the caller passes real subsystems.

const ARCH_STATUSES = new Set(["KEEP", "REBUILD", "REPLACE", "DROP"]);
const archComponentSchema = z.object({
  title: z.string().trim().min(1),
  domain: z.string().trim().min(1),
  role: z.string().nullish(),
  plain: z.string().nullish(),
  // frontend | backend | fullstack — parse-tolerant; an update that omits it keeps the
  // prior value (same preservation rule as role/plain).
  layer: z.string().nullish(),
  status: z.string().nullish(),
  files: z.array(z.string()).optional(),
  depends: z.array(z.string()).optional(),
  // Bugs / things worth investigating the agent found while examining this component.
  // Recorded as BugFlag rows with by="agent"; identical open flags are not duplicated,
  // so a beacon-refresh re-run doesn't pile up copies of the same finding.
  bugs: z.array(z.object({ note: z.string().trim().min(1).max(2000) })).optional(),
});
export type ArchComponentInput = z.input<typeof archComponentSchema>;

export async function upsertArchitectureComponents(input: unknown[]): Promise<number> {
  const parsed = z.array(archComponentSchema).parse(input);
  // De-dup by title (last wins) so a repeated title in one call updates rather than duplicates.
  const byKey = new Map<string, z.infer<typeof archComponentSchema>>();
  for (const c of parsed) byKey.set(c.title.toLowerCase(), c);
  const components = Array.from(byKey.values());
  if (!components.length) return 0;

  const existing = await db.query.node.findMany({
    where: (t, { eq }) => eq(t.view, "ARCHITECTURE"),
  });
  const nodeByTitle = new Map(existing.map((n) => [n.title.toLowerCase(), n]));
  const idByTitle = new Map<string, string>(existing.map((n) => [n.title.toLowerCase(), n.id]));

  // New components land INSIDE their domain's region (shortest masonry column); a brand-new
  // domain starts its own region below the board. Grows as we insert so two new components of
  // one domain stack instead of colliding.
  const occupied: Array<{ x: number; y: number; domain: string }> = existing.map((n) => ({
    x: n.x,
    y: n.y,
    domain: (n.cluster ?? "").trim() || "—",
  }));

  for (const c of components) {
    const key = c.title.toLowerCase();
    const status = c.status && ARCH_STATUSES.has(c.status) ? c.status : "KEEP";
    const prior = nodeByTitle.get(key);
    if (prior) {
      await db
        .update(node)
        .set({
          cluster: c.domain,
          layer: normalizeLayer(c.layer) ?? prior.layer,
          role: c.role ?? prior.role,
          plain: c.plain ?? prior.plain,
          status,
        })
        .where(eq(node.id, prior.id));
      if (c.files?.length) {
        await db.delete(nodeFile).where(eq(nodeFile.nodeId, prior.id));
        await db
          .insert(nodeFile)
          .values(Array.from(new Set(c.files)).map((path) => ({ nodeId: prior.id, path })));
      }
    } else {
      const d = c.domain.trim() || "—";
      const { x, y } = placeInGroup(
        occupied.filter((o) => o.domain === d),
        occupied,
      );
      occupied.push({ x, y, domain: d });
      const [created] = await db
        .insert(node)
        .values({
          view: "ARCHITECTURE",
          source: "MANUAL",
          cluster: c.domain,
          layer: normalizeLayer(c.layer),
          title: c.title,
          role: c.role ?? null,
          plain: c.plain ?? null,
          status,
          x,
          y,
        })
        .returning();
      if (c.files?.length) {
        await db
          .insert(nodeFile)
          .values(Array.from(new Set(c.files)).map((path) => ({ nodeId: created.id, path })));
      }
      idByTitle.set(key, created.id);
    }
  }

  // DEPENDS edges (mirror lib/init.ts persistArchitecture), de-duplicated.
  for (const c of components) {
    const fromId = idByTitle.get(c.title.toLowerCase());
    if (!fromId) continue;
    for (const dep of c.depends ?? []) {
      const toId = idByTitle.get(dep.trim().toLowerCase());
      if (!toId || toId === fromId) continue;
      const dup = await db.query.edge.findFirst({
        where: (t, { and, eq }) =>
          and(eq(t.fromId, fromId), eq(t.toId, toId), eq(t.kind, "DEPENDS")),
      });
      if (!dup)
        await db
          .insert(edge)
          .values({ fromId, toId, kind: "DEPENDS" })
          .catch(() => {});
    }
  }

  // Agent-discovered bug flags. An identical OPEN flag is skipped so a re-run
  // (beacon-refresh re-examining the same code) doesn't duplicate the same finding;
  // a resolved flag with the same note does NOT block — the bug came back.
  for (const c of components) {
    if (!c.bugs?.length) continue;
    const nodeId = idByTitle.get(c.title.toLowerCase());
    if (!nodeId) continue;
    for (const b of c.bugs) {
      const dup = await db.query.bugFlag.findFirst({
        where: (t, { and, eq, isNull }) =>
          and(eq(t.nodeId, nodeId), eq(t.note, b.note), isNull(t.resolvedAt)),
      });
      if (!dup) await db.insert(bugFlag).values({ nodeId, by: "agent", note: b.note });
    }
  }

  return components.length;
}

/** Mark a feature as shipped: replace its description with what the system actually does
 *  (markdown), record the files it spans (kept on the FEATURE for the context bundle), and flip
 *  its status to DONE in one call. Optionally upserts REAL architecture components when the
 *  feature changed a subsystem. Subsumes the older touchFiles + finishFeature flow so the
 *  terminal session only needs ONE tool call at the end. */
export async function describeFeature(input: {
  id?: string;
  title?: string;
  description: string;
  files?: string[];
  architecture?: unknown[];
}): Promise<{
  ok: boolean;
  id?: string;
  candidates?: Scored[];
  subtasksCompleted?: number;
  subtasksBlocked?: Array<{ id: string; title: string; status: string }>;
}> {
  const nodes = await db.query.node.findMany({ where: (t, { eq }) => eq(t.view, "ROADMAP") });
  let target = input.id ? nodes.find((n) => n.id === input.id) : undefined;
  if (!target && input.title) {
    const { best, candidates } = matchFeature(
      input.title,
      nodes.map((n) => ({ id: n.id, title: n.title })),
    );
    if (best) target = nodes.find((n) => n.id === best.id);
    else if (candidates.length) return { ok: false, candidates };
  }
  if (!target) return { ok: false };
  await db
    .update(node)
    .set({ plain: input.description, status: "DONE" })
    .where(eq(node.id, target.id));
  // Done is asserted for the whole feature — finish its unfinished sub-tasks too.
  const cascade = await cascadeCompletionDown(target.id);
  await propagateStatusUp(target.id);
  // The feature shipped — drop planned tables/endpoints of plans no longer in flight.
  await prunePlannedEntities();

  // Record files (idempotent — only adds new ones).
  if (input.files?.length) {
    const paths = Array.from(new Set(input.files.map(normalizePath).filter(Boolean)));
    for (const path of paths) {
      await db
        .insert(nodeFile)
        .values({ nodeId: target.id, path })
        .onConflictDoNothing({ target: [nodeFile.nodeId, nodeFile.path] });
    }
  }

  // The feature is done — drop the session's "current feature" pointer if it
  // pointed here, so edits stop auto-attaching and the loop closes cleanly (and a
  // future Stop-style nudge couldn't fire on already-registered work).
  await db
    .update(appSetting)
    .set({ currentFeatureId: null })
    .where(eq(appSetting.currentFeatureId, target.id));

  // Deliberate architecture updates (only when the feature changed a real subsystem). This is
  // the curated replacement for the old per-file auto-derivation — never one-node-per-file.
  if (input.architecture?.length) {
    await upsertArchitectureComponents(input.architecture);
  }

  await bumpVersion();
  return {
    ok: true,
    id: target.id,
    subtasksCompleted: cascade.completed || undefined,
    subtasksBlocked: cascade.blocked.length ? cascade.blocked : undefined,
  };
}

export interface DescribeFeatureItem {
  id?: string;
  title?: string;
  description: string;
  files?: string[];
  architecture?: unknown[];
}

/** Register MANY shipped features in one call (the batch close-out). Each item resolves
 *  independently — a miss returns ok:false for THAT item (with its title, so the agent
 *  can retry just that one) without sinking the rest. This is what lets the terminal
 *  session flip every feature a plan created to DONE in a single round-trip instead of
 *  one fuzzy-matched call per feature. */
export async function describeFeatures(
  items: DescribeFeatureItem[],
): Promise<{
  results: Array<{ ok: boolean; id?: string; title?: string; candidates?: Scored[] }>;
}> {
  const results = [];
  for (const it of items) {
    const r = await describeFeature(it);
    results.push({ ...r, title: it.title });
  }
  return { results };
}

/** Record the files a feature spans (reported by a session as it works). */
export async function touchFiles(input: {
  id?: string;
  title?: string;
  files: string[];
}): Promise<{ ok: boolean; id?: string; count?: number; candidates?: Scored[] }> {
  const files = Array.from(new Set((input.files ?? []).map(normalizePath).filter(Boolean)));
  const nodes = await db.query.node.findMany({ where: (t, { eq }) => eq(t.view, "ROADMAP") });

  let target = input.id ? nodes.find((n) => n.id === input.id) : undefined;
  if (!target && input.title) {
    const { best, candidates } = matchFeature(
      input.title,
      nodes.map((n) => ({ id: n.id, title: n.title })),
    );
    if (best) target = nodes.find((n) => n.id === best.id);
    else if (candidates.length) return { ok: false, candidates };
  }
  if (!target) return { ok: false };

  for (const path of files) {
    await db
      .insert(nodeFile)
      .values({ nodeId: target.id, path })
      .onConflictDoNothing({ target: [nodeFile.nodeId, nodeFile.path] });
  }
  await bumpVersion();
  const fileCount = (
    await db.select({ n: count() }).from(nodeFile).where(eq(nodeFile.nodeId, target.id))
  )[0].n;
  return { ok: true, id: target.id, count: fileCount };
}

// ── Bulk sub-task creation under a parent ───────────────────────────────────
// Lets a terminal session add N sub-tasks under a feature in one call (used by the
// `beacon_add_subtasks` MCP tool). Parent is resolved by id (preferred) or by
// fuzzy-title match. Children inherit the parent's view + cluster; positioning lands
// them in a row directly below the parent so they don't pile on top of existing nodes.

export interface AddSubtaskItem {
  title: string;
  plain?: string | null;
  /** FEATURE (default) | BUG — a bug discovered during work, recorded as a typed sub-task. */
  kind?: string | null;
  /** frontend | backend | fullstack — defaults to the parent's layer. */
  layer?: string | null;
}

export type AddSubtasksResult =
  | {
      ok: true;
      parent: { id: string; title: string };
      created: Array<{ id: string; title: string }>;
    }
  | { ok: false; reason: "no_items" }
  | { ok: false; reason: "parent_not_found" }
  | { ok: false; reason: "ambiguous"; candidates: Scored[] }
  | { ok: false; reason: "duplicate"; message: string };

export async function addSubtasksUnder(input: {
  parentId?: string | null;
  parentTitle?: string | null;
  items: AddSubtaskItem[];
}): Promise<AddSubtasksResult> {
  const items = input.items.filter((i) => i.title.trim());
  if (!items.length) return { ok: false, reason: "no_items" };

  type ParentNode = Awaited<ReturnType<typeof db.query.node.findFirst>>;
  let parent: ParentNode = undefined;
  if (input.parentId) {
    parent = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, input.parentId!) });
  } else if (input.parentTitle && input.parentTitle.trim()) {
    const candidates = await db.query.node.findMany({
      where: (t, { isNull }) => isNull(t.parentId),
      columns: { id: true, title: true, cluster: true, status: true },
    });
    const { best, candidates: alt } = matchFeature(
      input.parentTitle.trim(),
      candidates.map((c) => ({
        id: c.id,
        title: c.title,
        cluster: c.cluster,
        status: c.status,
      })),
    );
    if (best) parent = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, best.id) });
    else if (alt.length) return { ok: false, reason: "ambiguous", candidates: alt };
  }
  if (!parent) return { ok: false, reason: "parent_not_found" };
  const parentNode = parent;

  // Don't recreate a sub-task that already lives under this parent — hard-block so the agent
  // doesn't pile up near-identical children when it re-runs.
  const siblings = await db.query.node.findMany({
    where: (t, { eq }) => eq(t.parentId, parentNode.id),
    columns: { id: true, title: true },
  });
  const dups = items.filter((it) => matchFeature(it.title.trim(), siblings).best);
  if (dups.length) {
    return {
      ok: false,
      reason: "duplicate",
      message:
        `⛔ These sub-tasks already exist under "${parentNode.title}": ` +
        `${dups.map((d) => `"${d.title.trim()}"`).join(", ")}. ` +
        "Drop the duplicates — only add genuinely new sub-tasks.",
    };
  }

  // Obstacles = every node already on this view; children land in a row below the parent but get
  // nudged clear of anything already there (and of earlier children in this same batch).
  const obstacles = (
    await db.query.node.findMany({
      where: (t, { eq }) => eq(t.view, parentNode.view),
      columns: { x: true, y: true },
    })
  ).map((n) => ({ x: n.x, y: n.y }));
  const created: Array<{ id: string; title: string }> = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const pos = placeWithoutOverlap(obstacles, { x: parentNode.x + i * 240, y: parentNode.y + 200 });
    obstacles.push(pos);
    const n = await createNode({
      view: parentNode.view as "ROADMAP" | "ARCHITECTURE",
      kind: it.kind?.trim().toUpperCase() === "BUG" ? "BUG" : "FEATURE",
      title: it.title.trim(),
      plain: it.plain ?? null,
      cluster: parentNode.cluster ?? null,
      layer: normalizeLayer(it.layer) ?? normalizeLayer(parentNode.layer),
      parentId: parentNode.id,
      x: pos.x,
      y: pos.y,
    });
    created.push({ id: n.id, title: n.title });
  }

  // A fresh PENDING child under a previously DONE parent should bubble the parent
  // back to PENDING. Walking up from any one child reaches every ancestor.
  if (created.length) await propagateStatusUp(created[0].id);
  await bumpVersion();
  return { ok: true, parent: { id: parentNode.id, title: parentNode.title }, created };
}
