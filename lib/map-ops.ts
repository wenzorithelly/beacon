import { db } from "@/lib/db";
import { bumpVersion } from "@/lib/ingest";

// Map write operations used by the HTTP API + the MCP server. Lets a Claude Code
// session see the roadmap and register what it's working on: flag an existing
// feature as "being worked on", or add a new one under the right front (or a new front).

const norm = (s: string) => s.toLowerCase().trim();

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
  | { action: "flagged"; id: string; title: string }
  | { action: "created"; id: string; title: string; front: string | null };

/**
 * A session starts working on a feature. If it already exists on the map, flag it
 * IN_PROGRESS ("being worked on"). Otherwise create it under `front` (creating that
 * front if needed), marked IN_PROGRESS and tagged source=SESSION.
 */
export async function startFeature(input: {
  title: string;
  front?: string | null;
  detail?: string | null;
}): Promise<StartResult> {
  const title = input.title.trim();
  if (!title) throw new Error("title required");

  const nodes = await db.node.findMany({ where: { view: "ROADMAP" } });
  const existing =
    nodes.find((n) => norm(n.title) === norm(title)) ??
    nodes.find((n) => norm(n.title).includes(norm(title)) || norm(title).includes(norm(n.title)));

  if (existing) {
    await db.node.update({ where: { id: existing.id }, data: { status: "IN_PROGRESS" } });
    await bumpVersion();
    return { action: "flagged", id: existing.id, title: existing.title };
  }

  const fronts = nodes.filter((n) => !n.parentId);
  let parentId: string | null = null;
  let frontTitle: string | null = null;

  if (input.front) {
    const f = fronts.find((n) => norm(n.title) === norm(input.front!));
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

export async function finishFeature(title: string): Promise<{ ok: boolean; id?: string }> {
  const nodes = await db.node.findMany({ where: { view: "ROADMAP" } });
  const match =
    nodes.find((n) => norm(n.title) === norm(title)) ??
    nodes.find((n) => norm(n.title).includes(norm(title)));
  if (!match) return { ok: false };
  await db.node.update({ where: { id: match.id }, data: { status: "DONE" } });
  await bumpVersion();
  return { ok: true, id: match.id };
}
