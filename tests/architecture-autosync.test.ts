import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { node, dbTable } from "@/lib/drizzle/schema";
import { addWorkspace } from "@/lib/workspaces";
import { resetDb } from "./helpers";
import { POST as describePost } from "@/app/api/map/describe/route";
import { POST as approvePost } from "@/app/api/plan/approve/route";

// The architecture map / AGENTS.md should auto-refresh at the end of a plan run (a
// beacon_describe_feature that updates architecture, or a plan approval that changes the DB)
// — deterministically, without a manual /beacon-refresh. We verify the regen against a
// throwaway BEACON_REPO so the real repo's AGENTS.md is never touched.

let tmp: string;
let wsId: string;
let prevRepo: string | undefined;
const MANAGED_AGENTS = "# AGENTS.md\n\n<!-- beacon:start -->\nSTALE_BLOCK_SENTINEL\n<!-- beacon:end -->\n";

beforeEach(async () => {
  await resetDb();
  prevRepo = process.env.BEACON_REPO;
  tmp = mkdtempSync(join(tmpdir(), "beacon-arch-sync-"));
  writeFileSync(join(tmp, "AGENTS.md"), MANAGED_AGENTS);
  // BEACON_REPO forces repoRoot()→tmp (so AGENTS.md writes land in the throwaway dir, never the
  // real repo) and db→the test DB. Registering tmp lets workspaceIdFromRequest accept the header.
  process.env.BEACON_REPO = tmp;
  wsId = addWorkspace(tmp).id;
});

afterEach(() => {
  if (prevRepo === undefined) delete process.env.BEACON_REPO;
  else process.env.BEACON_REPO = prevRepo;
  rmSync(tmp, { recursive: true, force: true });
});

function reqWithWs(url: string, body?: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-beacon-workspace": wsId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function bareReq(url: string, body?: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const agentsText = () => readFileSync(join(tmp, "AGENTS.md"), "utf8");

describe("architecture map auto-updates after a plan run", () => {
  it("regenerates AGENTS.md when describe_feature updates the architecture", async () => {
    const [feat] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Some feature", cluster: "PLAN", status: "IN_PROGRESS" })
      .returning();
    await describePost(
      reqWithWs("http://test/api/map/describe", {
        id: feat.id,
        description: "done",
        architecture: [{ title: "Widget engine", domain: "UI", role: "renders widgets" }],
      }),
    );
    const out = agentsText();
    expect(out).toContain("Widget engine");
    expect(out).not.toContain("STALE_BLOCK_SENTINEL");
  });

  it("regenerates AGENTS.md when a plan is approved (DB reflected)", async () => {
    await db.insert(dbTable).values({ name: "widgets_xyz" });
    await approvePost(reqWithWs("http://test/api/plan/approve"));
    expect(agentsText()).toContain("widgets_xyz");
  });

  it("does NOT regenerate when describe carries no architecture change", async () => {
    const [feat] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Plain feature", cluster: "PLAN", status: "IN_PROGRESS" })
      .returning();
    await describePost(
      reqWithWs("http://test/api/map/describe", { id: feat.id, description: "done, no arch" }),
    );
    expect(agentsText()).toContain("STALE_BLOCK_SENTINEL");
  });

  it("does NOT touch AGENTS.md for a workspace-less request (protects the suite)", async () => {
    const [feat] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Bare feature", cluster: "PLAN", status: "IN_PROGRESS" })
      .returning();
    await describePost(
      bareReq("http://test/api/map/describe", {
        id: feat.id,
        description: "done",
        architecture: [{ title: "Should not appear", domain: "UI", role: "x" }],
      }),
    );
    expect(agentsText()).toContain("STALE_BLOCK_SENTINEL");
  });
});
