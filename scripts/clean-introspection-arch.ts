#!/usr/bin/env bun
/**
 * One-off cleanup: remove the per-file ARCHITECTURE pollution (source="INTROSPECTION" nodes the
 * old auto-derivation minted) across every registered workspace, then re-pack the surviving
 * curated components into the domain grid. Safe to re-run; idempotent. The auto-derivation that
 * created these is gone, so they can't come back.
 *
 *   bun scripts/clean-introspection-arch.ts
 */
import { and, eq } from "drizzle-orm";
import { db, runWithWorkspace } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { listWorkspaces, ensureWorkspaceDb } from "@/lib/workspaces";
import { bumpVersion } from "@/lib/ingest";
import { layoutArchitectureByDomain } from "@/lib/architecture-layout";

async function cleanWorkspace(): Promise<{ deleted: number; relaid: number }> {
  const del = await db
    .delete(node)
    .where(and(eq(node.view, "ARCHITECTURE"), eq(node.source, "INTROSPECTION")))
    .returning({ id: node.id });

  // Re-pack the curated survivors (INIT + MANUAL) into the domain-grouped grid.
  const nodes = await db.query.node.findMany({
    where: (t, { eq: eqf }) => eqf(t.view, "ARCHITECTURE"),
    orderBy: (t, { asc }) => asc(t.createdAt),
  });
  const wrapped = nodes.map((n) => ({ domain: n.cluster, n }));
  const pos = layoutArchitectureByDomain(wrapped);
  let relaid = 0;
  for (const w of wrapped) {
    const at = pos.get(w);
    if (!at || (w.n.x === at.x && w.n.y === at.y)) continue;
    await db.update(node).set({ x: at.x, y: at.y }).where(eq(node.id, w.n.id));
    relaid++;
  }

  const deleted = del.length;
  if (deleted || relaid) await bumpVersion();
  return { deleted, relaid };
}

const workspaces = listWorkspaces();
if (!workspaces.length) {
  console.log("No registered Beacon workspaces — nothing to clean.");
} else {
  for (const ws of workspaces) {
    try {
      await ensureWorkspaceDb(ws.id);
      const r = await runWithWorkspace(ws.id, () => cleanWorkspace());
      console.log(
        `[${ws.name}] removed ${r.deleted} per-file arch node(s); re-laid ${r.relaid} curated node(s).`,
      );
    } catch (e) {
      console.error(`[${ws.name}] skipped: ${e instanceof Error ? e.message : e}`);
    }
  }
}
