// The workspace's STATUS VOCABULARY once Linear is connected: every card's Status picker offers
// the team's real workflow states ("Backlog / Todo / In Progress / In Review / Done / Canceled /
// Duplicate") instead of Beacon's five internal ones.
//
// It applies WORKSPACE-WIDE, Beacon-native cards included — one board, one vocabulary. The
// difference is only what a write does: a LINEAR card pushes the new state to the issue, a
// Beacon-native card records it locally and Linear never hears about it (it has no issue to
// update, and this route never creates one).
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { pinned } from "@/lib/api-workspace";
import { fetchTeamStates, sortWorkflowStates, stateMapFromStates, updateIssue } from "@/lib/linear/client";
import { getLinearFlag, setLinearFlag } from "@/lib/linear/config";
import { linearStateToStatus, parseExternalMeta } from "@/lib/linear/mapping";
import type { LinearWorkflowState } from "@/lib/linear/types";

export const dynamic = "force-dynamic";

/** The states to offer for a card. A LINEAR card uses ITS OWN team's list (the scope can span
 *  teams); everything else uses the workspace's primary team. Cached in the Linear config by the
 *  sync — fetched + cached here only if a card asks before the first sync warmed it. */
async function statesFor(teamId: string | undefined): Promise<{ states: LinearWorkflowState[]; teamId?: string }> {
  const { config } = await getLinearFlag();
  if (!config?.apiKey) return { states: [] };
  const id = teamId ?? config.primaryTeamId;
  if (!id) return { states: [] };

  // Sorted on READ, not just on fetch: a list cached by an older build (or by a future Linear that
  // adds a state type) is still handed back in Linear's own order.
  const cached = config.statesByTeam?.[id];
  if (cached?.length) return { states: sortWorkflowStates(cached), teamId: id };

  const states = await fetchTeamStates(config.apiKey, id);
  await setLinearFlag({
    config: {
      statesByTeam: { ...(config.statesByTeam ?? {}), [id]: states },
      stateMapByTeam: { ...(config.stateMapByTeam ?? {}), [id]: stateMapFromStates(states) },
    },
  });
  return { states, teamId: id };
}

// GET ?teamId= → the workflow states to show in a Status picker. Empty list = not connected, or no
// team resolved yet; the caller falls back to Beacon's own statuses.
export const GET = pinned(async (req: Request) => {
  const teamId = new URL(req.url).searchParams.get("teamId") ?? undefined;
  try {
    const { states } = await statesFor(teamId);
    return Response.json({ states });
  } catch (e) {
    // A picker must never break the panel — degrade to Beacon's statuses.
    console.error("[beacon-linear] status vocabulary fetch failed:", e instanceof Error ? e.message : e);
    return Response.json({ states: [] });
  }
});

// POST { nodeId, stateId } → set a card's status to a Linear workflow state.
export const POST = pinned(async (req: Request) => {
  const { nodeId, stateId } = (await req.json().catch(() => ({}))) as {
    nodeId?: string;
    stateId?: string;
  };
  if (!nodeId || !stateId) return Response.json({ error: "nodeId and stateId are required" }, { status: 400 });

  const row = await db.query.node.findFirst({ where: eq(node.id, nodeId) });
  if (!row) return Response.json({ error: "No such card" }, { status: 404 });

  const meta = parseExternalMeta(row.externalMeta);
  const { states } = await statesFor(meta?.team?.id);
  const state = states.find((s) => s.id === stateId);
  if (!state) return Response.json({ error: "No such workflow state" }, { status: 400 });

  const now = new Date();
  const status = linearStateToStatus(state.type);
  const set: Record<string, unknown> = {
    status,
    updatedAt: now,
    // Remember the EXACT state, not just the Beacon status it maps to: several states share one
    // type ("Todo" and "Backlog" are both unstarted/backlog), so re-deriving from the status alone
    // would silently rewrite the user's choice to whichever one sorts first.
    externalMeta: JSON.stringify({
      ...(meta ?? {}),
      state: { id: state.id, name: state.name, color: state.color, type: state.type },
    }),
  };

  // Only a card that IS a Linear issue gets pushed. A Beacon-native card speaks the vocabulary
  // without ever entering Linear.
  if (row.source === "LINEAR" && row.externalId) {
    const { config } = await getLinearFlag();
    if (config?.apiKey) {
      const externalUpdatedAt = await updateIssue(config.apiKey, row.externalId, { stateId });
      set.externalUpdatedAt = new Date(externalUpdatedAt);
      // Stamp externalSyncedAt with it: this IS the mirror of our own write, so the next reconcile
      // must not read it as an unsynced Beacon-side edit and push it a second time.
      set.externalSyncedAt = now;
      if (row.externalSnapshot) {
        const snap = JSON.parse(row.externalSnapshot) as Record<string, unknown>;
        set.externalSnapshot = JSON.stringify({ ...snap, status });
      }
    }
  }

  await db.update(node).set(set).where(eq(node.id, nodeId));
  return Response.json({ ok: true, status, state });
});
