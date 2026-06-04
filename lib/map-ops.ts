import { db } from "@/lib/db";
import { bumpVersion } from "@/lib/ingest";
import { matchFeature, type Scored } from "@/lib/match";
import { repoRoot } from "@/lib/project";

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
  const nodes = await db.node.findMany({
    where: { view: "ROADMAP" },
    orderBy: { createdAt: "asc" },
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
  | { action: "ambiguous"; candidates: Scored[] };

async function setStatus(id: string, status: string) {
  await db.node.update({ where: { id }, data: { status } });
  await bumpVersion();
}

/**
 * A session starts working on a feature. Resolution order:
 *  1. explicit `id` (from beacon_map) → flag it (100% reliable)
 *  2. confident, unambiguous fuzzy match → flag it
 *  3. plausible-but-ambiguous matches → return candidates to disambiguate
 *  4. no match → create it under `front` (creating that front if needed)
 */
export async function startFeature(input: {
  title: string;
  id?: string | null;
  front?: string | null;
  detail?: string | null;
}): Promise<StartResult> {
  const title = input.title.trim();
  if (!title) throw new Error("title required");

  const nodes = await db.node.findMany({ where: { view: "ROADMAP" } });

  if (input.id) {
    const n = nodes.find((x) => x.id === input.id);
    if (n) {
      await setStatus(n.id, "IN_PROGRESS");
      return { action: "flagged", id: n.id, title: n.title, via: "id" };
    }
  }

  const { best, candidates } = matchFeature(
    title,
    nodes.map((n) => ({ id: n.id, title: n.title })),
  );
  if (best) {
    await setStatus(best.id, "IN_PROGRESS");
    return { action: "flagged", id: best.id, title: best.title, via: "match", score: best.score };
  }
  if (candidates.length) return { action: "ambiguous", candidates };

  // No match → create.
  const fronts = nodes.filter((n) => !n.parentId);
  let parentId: string | null = null;
  let frontTitle: string | null = null;

  if (input.front) {
    const f = matchFeature(input.front, fronts.map((n) => ({ id: n.id, title: n.title }))).best;
    if (f) {
      parentId = f.id;
      frontTitle = f.title;
    } else {
      const created = await db.node.create({
        data: {
          view: "ROADMAP",
          title: input.front,
          status: "PENDING",
          source: "SESSION",
          x: fronts.length * 340,
          y: 0,
        },
      });
      parentId = created.id;
      frontTitle = created.title;
    }
  }

  const siblings = parentId
    ? nodes.filter((n) => n.parentId === parentId).length
    : fronts.length;
  const task = await db.node.create({
    data: {
      view: "ROADMAP",
      title,
      plain: input.detail ?? null,
      status: "IN_PROGRESS",
      source: "SESSION",
      parentId,
      x: parentId ? (fronts.find((f) => f.id === parentId)?.x ?? 0) : siblings * 300,
      y: parentId ? 160 + siblings * 110 : 0,
    },
  });
  await bumpVersion();
  return { action: "created", id: task.id, title, front: frontTitle };
}

export async function finishFeature(input: {
  title?: string;
  id?: string;
}): Promise<{ ok: boolean; id?: string; candidates?: Scored[] }> {
  const nodes = await db.node.findMany({ where: { view: "ROADMAP" } });

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

/** Record the files a feature spans (reported by a session as it works). */
export async function touchFiles(input: {
  id?: string;
  title?: string;
  files: string[];
}): Promise<{ ok: boolean; id?: string; count?: number; candidates?: Scored[] }> {
  const files = Array.from(new Set((input.files ?? []).map(normalizePath).filter(Boolean)));
  const nodes = await db.node.findMany({ where: { view: "ROADMAP" } });

  let node = input.id ? nodes.find((n) => n.id === input.id) : undefined;
  if (!node && input.title) {
    const { best, candidates } = matchFeature(
      input.title,
      nodes.map((n) => ({ id: n.id, title: n.title })),
    );
    if (best) node = nodes.find((n) => n.id === best.id);
    else if (candidates.length) return { ok: false, candidates };
  }
  if (!node) return { ok: false };

  for (const path of files) {
    await db.nodeFile.upsert({
      where: { nodeId_path: { nodeId: node.id, path } },
      create: { nodeId: node.id, path },
      update: {},
    });
  }
  await bumpVersion();
  const count = await db.nodeFile.count({ where: { nodeId: node.id } });
  return { ok: true, id: node.id, count };
}
