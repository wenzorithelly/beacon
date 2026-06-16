import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-share-builder-"));

import { db } from "@/lib/db";
import { node, dbTable } from "@/lib/drizzle/schema";
import { resetDb } from "./helpers";
import { buildBoardsSnapshot } from "@/lib/share-builder";
import { shareSnapshotSchema } from "@/lib/share-snapshot";

beforeEach(async () => {
  await resetDb();
  // resetDb leaves the db-design tables alone — clear them so each case starts clean.
  await db.delete(dbTable);
});

async function seedRoadmap() {
  await db
    .insert(node)
    .values({ view: "ROADMAP", title: "Shareable link", cluster: "LAUNCH", priority: 1, status: "PENDING" });
}

describe("buildBoardsSnapshot", () => {
  it("includes ONLY the selected board tabs", async () => {
    await seedRoadmap();
    const snap = await buildBoardsSnapshot(["ROADMAP"]);
    expect(snap.kind).toBe("boards");
    expect(snap.selectedTabs).toEqual(["ROADMAP"]);
    expect(snap.roadmap).toBeDefined();
    expect(snap.architecture).toBeUndefined();
    expect(snap.database).toBeUndefined();
  });

  it("produces a snapshot that round-trips the wire schema, with node positions", async () => {
    await seedRoadmap();
    const snap = await buildBoardsSnapshot(["ROADMAP"]);
    expect(shareSnapshotSchema.safeParse(snap).success).toBe(true);
    const n = snap.roadmap!.nodes.find((x) => x.title === "Shareable link")!;
    expect(typeof n.x).toBe("number");
    expect(typeof n.y).toBe("number");
  });

  it("carries seeded tables on the DATABASE tab, with no in-flight draft", async () => {
    await db.insert(dbTable).values({ name: "SharedBoard", domain: "LAUNCH", source: "MANUAL" });
    const snap = await buildBoardsSnapshot(["DATABASE"]);
    expect(snap.selectedTabs).toEqual(["DATABASE"]);
    expect(snap.database!.tables.some((t) => t.name === "SharedBoard")).toBe(true);
    expect(snap.database!.draft).toBeNull();
  });

  it("captures all three board tabs when requested", async () => {
    await seedRoadmap();
    await db.insert(dbTable).values({ name: "SharedBoard", source: "MANUAL" });
    const snap = await buildBoardsSnapshot(["ROADMAP", "ARCHITECTURE", "DATABASE"]);
    expect(snap.selectedTabs).toEqual(["ROADMAP", "ARCHITECTURE", "DATABASE"]);
    expect(snap.roadmap && snap.architecture && snap.database).toBeTruthy();
    expect(snap.workspaceLabel.length).toBeGreaterThan(0);
  });
});
