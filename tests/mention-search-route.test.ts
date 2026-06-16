import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-mention-"));

import { db } from "@/lib/db";
import { codeFile, dbTable, endpoint, node, note } from "@/lib/drizzle/schema";
import { GET } from "@/app/api/mention-search/route";

beforeEach(async () => {
  await db.delete(node);
  await db.delete(note);
  await db.delete(codeFile);
  await db.delete(dbTable);
  await db.delete(endpoint);
});

async function search(q: string) {
  const res = await GET(new Request(`http://test/api/mention-search?q=${encodeURIComponent(q)}`));
  return (await res.json()) as { hits: { kind: string; ref: string; label: string }[] };
}

describe("GET /api/mention-search", () => {
  it("returns no hits for an empty query", async () => {
    const { hits } = await search("");
    expect(hits).toEqual([]);
  });

  it("searches across files, folders, features, tables, endpoints and notes", async () => {
    await db.insert(codeFile).values({ path: "app/api/plan/route.ts", x: 0, y: 0, inDegree: 0, outDegree: 0 });
    await db.insert(node).values({ view: "ROADMAP", title: "Plan review loop", cluster: "PLAN" });
    await db.insert(dbTable).values({ name: "PlanContract", source: "CODE", x: 0, y: 0 });
    await db.insert(endpoint).values({ method: "POST", path: "/api/plan", source: "CODE", x: 0, y: 0 });
    await db.insert(note).values({ title: "Planning ideas", ord: 1 });

    const { hits } = await search("plan");
    const kinds = new Set(hits.map((h) => h.kind));
    for (const k of ["file", "folder", "feature", "table", "endpoint", "note"]) {
      expect(kinds.has(k)).toBe(true);
    }
    const feature = hits.find((h) => h.kind === "feature");
    expect(feature?.label).toBe("Plan review loop");
    const file = hits.find((h) => h.kind === "file");
    expect(file?.ref).toBe("app/api/plan/route.ts");
  });
});
