import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// Isolate the per-workspace data dir so each test starts clean.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-draft-excl-"));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { readRoadmapBoard } from "@/lib/board-readers";
import { listMap } from "@/lib/map-ops";

// Regression: a plan under review is persisted as source="DRAFT" ROADMAP nodes (the /plan
// review board owns that layer). The LIVE roadmap reads — readRoadmapBoard (/map page +
// share snapshots) and listMap (beacon_map, the agent's view) — must NOT include them, or
// merely PRESENTING a plan pollutes the live roadmap with cards before the user approves.
// ensureBoardArranged + the /api/plan dedup already exclude DRAFT; these readers must match.

describe("live roadmap reads exclude DRAFT (un-approved) proposals", () => {
  beforeEach(async () => {
    await db.delete(node).where(eq(node.view, "ROADMAP"));
    await db.insert(node).values([
      { view: "ROADMAP", source: "MANUAL", status: "PENDING", title: "Real approved card", x: 0, y: 0 },
      { view: "ROADMAP", source: "DRAFT", status: "PENDING", title: "Unapproved proposal", x: 0, y: 300 },
    ]);
  });

  it("readRoadmapBoard omits DRAFT nodes from the /map roadmap", async () => {
    const { nodes } = await readRoadmapBoard("ROADMAP");
    const titles = nodes.map((n) => n.title);
    expect(titles).toContain("Real approved card");
    expect(titles).not.toContain("Unapproved proposal");
  });

  it("listMap (beacon_map) omits DRAFT nodes from the agent's roadmap view", async () => {
    const { fronts } = await listMap();
    const titles = fronts.map((f) => f.title);
    expect(titles).toContain("Real approved card");
    expect(titles).not.toContain("Unapproved proposal");
  });
});
