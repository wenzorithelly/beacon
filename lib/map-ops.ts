import { z } from "zod";
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db-drizzle";
import { node, nodeFile, edge, appSetting } from "@/lib/drizzle/schema";
import { bumpVersion } from "@/lib/ingest";
import { matchFeature, type Scored } from "@/lib/match";
import { validateFeatureCreation, validateFront } from "@/lib/feature-rules";
import { placeWithoutOverlap } from "@/lib/node-placement";
import { forceLayoutRoadmap } from "@/lib/roadmap-force-layout";
import {
  readRoadmapLayoutSig,
  roadmapStructureSignature,
  writeRoadmapLayoutSig,
} from "@/lib/roadmap-layout-state";
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

/**
 * A session starts working on a feature. Resolution order:
 *  1. explicit `id` (from beacon_map) → flag it (100% reliable)
 *  2. confident, unambiguous fuzzy match → flag it
 *  3. plausible-but-ambiguous matches → return candidates to disambiguate
 *  4. no match → create it under `front` (creating that front if needed)
 */
// Lay the committed roadmap board out as an ORGANIC 2D graph (d3-force): independent features
// spread across the width, dependency-linked features pull into tight clusters with short edges.
// Called on every /map load and after a feature is created, so an existing board self-heals.
//
// Re-runs ONLY when the graph STRUCTURE changes (a feature/edge added or removed), tracked by a
// per-workspace signature file. A plain refresh, a manual card drag, or a Group-by arrangement
// leaves the signature untouched and is therefore preserved — the layout never fights the user.
// DRAFT nodes are excluded (a plan under review owns its own layout in lib/feature-design). Does
// NOT bump the sync version.
export async function healRoadmapLayout(): Promise<void> {
  const all = await db.query.node.findMany({
    where: (t, { eq }) => eq(t.view, "ROADMAP"),
    columns: { id: true, parentId: true, source: true, x: true, y: true },
  });
  const nodes = all.filter((n) => n.source !== "DRAFT");
  if (nodes.length < 2) return;
  const ids = nodes.map((n) => n.id);
  const edges = await db.query.edge.findMany({
    where: (t, { and, eq }) =>
      and(eq(t.kind, "DEPENDS"), inArray(t.fromId, ids), inArray(t.toId, ids)),
    columns: { fromId: true, toId: true },
  });

  const sig = roadmapStructureSignature(ids, edges);
  if (readRoadmapLayoutSig() === sig) return; // structure unchanged → keep the current arrangement

  const pos = forceLayoutRoadmap(
    nodes.map((n) => ({ id: n.id, parentId: n.parentId })),
    edges,
  );
  const updates: Promise<unknown>[] = [];
  for (const n of nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    if (Math.round(p.x) === Math.round(n.x) && Math.round(p.y) === Math.round(n.y)) continue;
    updates.push(db.update(node).set({ x: p.x, y: p.y }).where(eq(node.id, n.id)));
  }
  await Promise.all(updates);
  writeRoadmapLayoutSig(sig);
}

export async function startFeature(input: {
  title: string;
  id?: string | null;
  front?: string | null;
  detail?: string | null;
  cluster?: string | null;
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
  if (frontInput) {
    const f = matchFeature(frontInput, fronts.map((n) => ({ id: n.id, title: n.title }))).best!;
    parentId = f.id;
    frontTitle = f.title;
    inheritedCluster = nodes.find((n) => n.id === f.id)?.cluster ?? null;
  }

  const cluster = (input.cluster?.trim() || inheritedCluster) ?? null;
  const createErr = validateFeatureCreation({
    title,
    category: cluster,
    existing: nodes.map((n) => ({ id: n.id, title: n.title, cluster: n.cluster, status: n.status })),
  });
  if (createErr) return { action: "rejected", message: createErr };

  const siblings = parentId
    ? nodes.filter((n) => n.parentId === parentId).length
    : fronts.length;
  const pos = placeWithoutOverlap(
    nodes.map((n) => ({ x: n.x, y: n.y })),
    {
      x: parentId ? (fronts.find((f) => f.id === parentId)?.x ?? 0) : siblings * 300,
      y: parentId ? 160 + siblings * 110 : 0,
    },
  );
  const [task] = await db
    .insert(node)
    .values({
      view: "ROADMAP",
      title,
      plain: input.detail ?? null,
      cluster,
      status: "IN_PROGRESS",
      source: "SESSION",
      parentId,
      x: pos.x,
      y: pos.y,
    })
    .returning();
  await propagateStatusUp(task.id);
  // A new feature changes the graph structure → re-tidy the board organically so the new card is
  // placed sensibly instead of in a blind row.
  await healRoadmapLayout();
  await bumpVersion();
  await setCurrent(task.id);
  return { action: "created", id: task.id, title, front: frontTitle };
}

export async function finishFeature(input: {
  title?: string;
  id?: string;
}): Promise<{ ok: boolean; id?: string; candidates?: Scored[] }> {
  const nodes = await db.query.node.findMany({ where: (t, { eq }) => eq(t.view, "ROADMAP") });

  if (input.id) {
    const n = nodes.find((x) => x.id === input.id);
    if (n) {
      await setStatus(n.id, "DONE");
      return { ok: true, id: n.id };
    }
  }
  if (!input.title) return { ok: false };

  const { best, candidates } = matchFeature(
    input.title,
    nodes.map((n) => ({ id: n.id, title: n.title })),
  );
  if (best) {
    await setStatus(best.id, "DONE");
    return { ok: true, id: best.id };
  }
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
  status: z.string().nullish(),
  files: z.array(z.string()).optional(),
  depends: z.array(z.string()).optional(),
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

  // Column x + next free y per domain, seeded from existing nodes so new components stack below
  // their domain siblings rather than overlapping them. New domains get a fresh column.
  const xByDomain = new Map<string, number>();
  const maxYByDomain = new Map<string, number>();
  for (const n of existing) {
    const d = (n.cluster ?? "").trim() || "—";
    if (!xByDomain.has(d)) xByDomain.set(d, n.x);
    maxYByDomain.set(d, Math.max(maxYByDomain.get(d) ?? -150, n.y));
  }
  let nextCol = existing.length ? Math.max(...existing.map((n) => n.x)) + 320 : 0;

  for (const c of components) {
    const key = c.title.toLowerCase();
    const status = c.status && ARCH_STATUSES.has(c.status) ? c.status : "KEEP";
    const prior = nodeByTitle.get(key);
    if (prior) {
      await db
        .update(node)
        .set({ cluster: c.domain, role: c.role ?? prior.role, plain: c.plain ?? prior.plain, status })
        .where(eq(node.id, prior.id));
      if (c.files?.length) {
        await db.delete(nodeFile).where(eq(nodeFile.nodeId, prior.id));
        await db
          .insert(nodeFile)
          .values(Array.from(new Set(c.files)).map((path) => ({ nodeId: prior.id, path })));
      }
    } else {
      const d = c.domain.trim() || "—";
      let x = xByDomain.get(d);
      if (x === undefined) {
        x = nextCol;
        nextCol += 320;
        xByDomain.set(d, x);
      }
      const y = (maxYByDomain.get(d) ?? -150) + 150;
      maxYByDomain.set(d, y);
      const [created] = await db
        .insert(node)
        .values({
          view: "ARCHITECTURE",
          source: "MANUAL",
          cluster: c.domain,
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
}): Promise<{ ok: boolean; id?: string; candidates?: Scored[] }> {
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
  await propagateStatusUp(target.id);

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
  return { ok: true, id: target.id };
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
      title: it.title.trim(),
      plain: it.plain ?? null,
      cluster: parentNode.cluster ?? null,
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
