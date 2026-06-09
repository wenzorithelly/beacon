import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-edges-"));

import { and, count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node, edge } from "@/lib/drizzle/schema";
import { createEdge } from "@/lib/mutations";

async function n(title: string) {
  const [r] = await db.insert(node).values({ view: "ROADMAP", title }).returning();
  return r;
}

describe("createEdge (roadmap dependency edges from drag-to-connect)", () => {
  beforeEach(async () => {
    await db.delete(edge);
    await db.delete(node).where(eq(node.view, "ROADMAP"));
  });

  it("creates a DEPENDS edge between two nodes by default", async () => {
    const a = await n("A");
    const b = await n("B");
    const e = await createEdge({ fromId: a.id, toId: b.id });
    expect(e.fromId).toBe(a.id);
    expect(e.toId).toBe(b.id);
    expect(e.kind).toBe("DEPENDS");
  });

  it("is idempotent on duplicate drags — returns the existing edge instead of throwing", async () => {
    const a = await n("A");
    const b = await n("B");
    const e1 = await createEdge({ fromId: a.id, toId: b.id });
    const e2 = await createEdge({ fromId: a.id, toId: b.id });
    expect(e2.id).toBe(e1.id);
    const cnt = (
      await db
        .select({ c: count() })
        .from(edge)
        .where(and(eq(edge.fromId, a.id), eq(edge.toId, b.id)))
    )[0].c;
    expect(cnt).toBe(1);
  });

  it("rejects self-edges", async () => {
    const a = await n("A");
    await expect(createEdge({ fromId: a.id, toId: a.id })).rejects.toThrow();
  });
});
