import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-entities-"));

import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { resetDb } from "./helpers";
import { GET } from "@/app/api/entities/route";

beforeEach(resetDb);

const LONG = "x".repeat(2000);

async function entities(qs: string) {
  const res = await GET(new Request(`http://localhost/api/entities?${qs}`));
  return (await res.json()) as { items: Array<{ title: string; plain: string | null }> };
}

// beacon_entities used to dump every feature's full description with no cap → a ~124k-char
// tool-result overflow. The default response now truncates `plain`; full text is opt-in.
describe("GET /api/entities — compact projection", () => {
  it("truncates plain to ~160 chars by default", async () => {
    await db.insert(node).values({ view: "ROADMAP", title: "Long one", cluster: "DATA", plain: LONG });
    const { items } = await entities("kind=features");
    const it0 = items.find((i) => i.title === "Long one")!;
    expect(it0.plain!.length).toBeLessThanOrEqual(161);
    expect(it0.plain!.endsWith("…")).toBe(true);
  });

  it("returns the full plain when full=1", async () => {
    await db.insert(node).values({ view: "ROADMAP", title: "Long one", cluster: "DATA", plain: LONG });
    const { items } = await entities("kind=features&full=1");
    expect(items.find((i) => i.title === "Long one")!.plain).toBe(LONG);
  });

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++)
      await db.insert(node).values({ view: "ROADMAP", title: `Card ${i}`, cluster: "DATA" });
    const { items } = await entities("kind=features&limit=2");
    expect(items.length).toBe(2);
  });

  it("stays well under the old 124k overflow for many long-description cards", async () => {
    for (let i = 0; i < 50; i++)
      await db
        .insert(node)
        .values({ view: "ROADMAP", title: `Card ${i}`, cluster: "DATA", plain: LONG });
    const res = await GET(new Request("http://localhost/api/entities?kind=features"));
    const text = await res.text();
    expect(text.length).toBeLessThan(30_000);
  });
});
