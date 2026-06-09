import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// Isolate the per-workspace data dir into a throwaway tmp dir so each test starts clean.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-plan-route-"));

import { and, count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { readDraftDoc } from "@/lib/draft-store";
import { dataDir } from "@/lib/project";
import { POST as planPost, DELETE as planDelete } from "@/app/api/plan/route";
import {
  POST as annotationsPost,
  GET as annotationsGet,
  DELETE as annotationsDelete,
} from "@/app/api/plan/annotations/route";

function reqJson(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// The GET/DELETE handlers now take a Request (to pin the workspace). Tests run without the
// x-beacon-workspace header, so the handler falls back to BEACON_DATA_DIR — but the param is
// still required, so give it a bare Request.
function emptyReq(): Request {
  return new Request("http://test/api/plan");
}

const planA = {
  description: "round 1: initial proposal",
  draft: {
    tables: [
      {
        name: "pr_orgs",
        columns: [{ name: "id", type: "UUID", isPk: true, nullable: false }],
      },
    ],
    relations: [],
    endpoints: [],
  },
};
const planB = {
  description: "round 2: revised proposal",
  draft: {
    tables: [
      {
        name: "pr_orgs",
        columns: [
          { name: "id", type: "UUID", isPk: true, nullable: false },
          { name: "name", type: "TEXT", nullable: false },
        ],
      },
    ],
    relations: [],
    endpoints: [],
  },
};

describe("POST /api/plan resets the annotation state on a fresh round", () => {
  beforeEach(async () => {
    // Wipe annotations + plan from the previous test so each starts clean.
    await annotationsDelete(emptyReq());
    await planDelete(emptyReq());
    // The data dir's persisted draft + plan-meta files are also wiped by planDelete.
    rmSync(join(dataDir(), "draft.json"), { force: true });
    rmSync(join(dataDir(), "draft-verdict.json"), { force: true });
    rmSync(join(dataDir(), "plan-verdict.json"), { force: true });
  });

  it("clears submitted annotations from the previous round when a new plan is posted", async () => {
    // Round 1: agent proposes plan A.
    const r1 = await planPost(reqJson("http://test/api/plan", planA));
    expect(r1.status).toBe(200);

    // User submits feedback on plan A.
    await annotationsPost(
      reqJson("http://test/api/plan/annotations", {
        annotations: [{ id: "x", excerpt: "pr_orgs", comment: "rename to organisations" }],
        globalComment: "shape this differently",
      }),
    );
    const before = await (await annotationsGet(emptyReq())).json();
    expect(before.submitted).toBe(true);
    expect(before.annotations.length).toBe(1);
    expect(before.feedback).toContain("rename to organisations");

    // Round 2: agent re-proposes after reading the feedback.
    const r2 = await planPost(reqJson("http://test/api/plan", planB));
    expect(r2.status).toBe(200);

    // Annotation state must be reset so the MCP polling loop doesn't immediately
    // hand the agent back the stale feedback on its first tick.
    const after = await (await annotationsGet(emptyReq())).json();
    expect(after.submitted).toBe(false);
    expect(after.annotations).toEqual([]);
    expect(after.globalComment).toBe("");
    expect(after.feedback).toBe("");
  });

  it("does not wipe in-progress (not yet submitted) annotations on the initial post", async () => {
    // First-ever plan: there's no previous round — nothing to wipe. Sanity check.
    const r = await planPost(reqJson("http://test/api/plan", planA));
    expect(r.status).toBe(200);
    const a = await (await annotationsGet(emptyReq())).json();
    expect(a.submitted).toBe(false);
    expect(a.annotations).toEqual([]);
  });
});

describe("Submit feedback bundles board edits (DB diff + feature changes) into the payload", () => {
  beforeEach(async () => {
    await annotationsDelete(emptyReq());
    await planDelete(emptyReq());
    rmSync(join(dataDir(), "draft.json"), { force: true });
    rmSync(join(dataDir(), "draft-verdict.json"), { force: true });
    rmSync(join(dataDir(), "plan-verdict.json"), { force: true });
    await db.delete(node).where(eq(node.view, "ROADMAP"));
  });

  it("returns a feedback payload that includes the DB diff the user made on the /db canvas", async () => {
    // Round 1: agent proposes plan A (one table with just `id`).
    await planPost(reqJson("http://test/api/plan", planA));

    // The user edited the draft on the /db canvas — added an `email` column.
    const original = readDraftDoc()!;
    const edited = JSON.parse(JSON.stringify(original));
    edited.tables[0].columns.push({
      name: "email",
      type: "TEXT",
      isPk: false,
      isFk: false,
      nullable: false,
      note: null,
    });

    // Submit feedback, posting the edited draft alongside the annotations.
    await annotationsPost(
      reqJson("http://test/api/plan/annotations", {
        annotations: [],
        globalComment: "",
        draft: edited,
      }),
    );

    const { feedback, submitted } = (await (await annotationsGet(emptyReq())).json()) as {
      feedback: string;
      submitted: boolean;
    };
    expect(submitted).toBe(true);
    expect(feedback).toContain("Board edits");
    expect(feedback).toContain("Database");
    expect(feedback).toContain("added column **pr_orgs.email**");
  });

  it("surfaces feature additions the user dropped on the /map canvas during review", async () => {
    // Plan with one proposed feature.
    await planPost(
      reqJson("http://test/api/plan", {
        description: "round with a feature",
        features: [{ title: "Original feature" }],
      }),
    );

    // User added a brand-new DRAFT feature on the canvas (simulating "+ Node" in plan mode).
    await db.insert(node).values({
      view: "ROADMAP",
      source: "DRAFT",
      status: "PENDING",
      title: "User-added feature",
      x: 0,
      y: 0,
    });

    await annotationsPost(
      reqJson("http://test/api/plan/annotations", { annotations: [] }),
    );
    const { feedback } = (await (await annotationsGet(emptyReq())).json()) as { feedback: string };
    expect(feedback).toContain("Features");
    expect(feedback).toContain("added feature **User-added feature**");
  });

  it("returns an empty feedback when nothing was annotated and nothing changed on the boards", async () => {
    await planPost(reqJson("http://test/api/plan", planA));
    await annotationsPost(
      reqJson("http://test/api/plan/annotations", { annotations: [] }),
    );
    const { feedback, submitted } = (await (await annotationsGet(emptyReq())).json()) as {
      feedback: string;
      submitted: boolean;
    };
    // The submit succeeded but there's literally nothing to hand back — the MCP polling
    // loop must NOT treat this as a verdict.
    expect(submitted).toBe(true);
    expect(feedback).toBe("");
  });
});

describe("POST /api/plan enforces category + priority on every feature", () => {
  beforeEach(async () => {
    await planDelete(emptyReq());
    rmSync(join(dataDir(), "plan-verdict.json"), { force: true });
  });

  it("rejects (422) a structured feature missing category/priority and persists nothing", async () => {
    const res = await planPost(
      reqJson("http://test/api/plan", {
        description: "incomplete features",
        features: [{ title: "Search" }], // no cluster, no priority
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Search");
    expect(body.error).toContain("category");
    // Nothing was persisted.
    const drafts = (
      await db
        .select({ n: count() })
        .from(node)
        .where(and(eq(node.source, "DRAFT"), eq(node.view, "ROADMAP")))
    )[0].n;
    expect(drafts).toBe(0);
  });

  it("accepts a feature with category + priority (priority 0 included)", async () => {
    const res = await planPost(
      reqJson("http://test/api/plan", {
        description: "complete features",
        features: [
          { title: "Search", cluster: "SEARCH", priority: 2 },
          { title: "Critical path", cluster: "DATA", priority: 0 },
        ],
      }),
    );
    expect(res.ok).toBe(true);
    const nodes = await db.query.node.findMany({
      where: (t, { and, eq }) => and(eq(t.source, "DRAFT"), eq(t.view, "ROADMAP")),
    });
    expect(nodes).toHaveLength(2);
    expect(nodes.find((n) => n.title === "Critical path")?.priority).toBe(0);
    expect(nodes.find((n) => n.title === "Search")?.cluster).toBe("SEARCH");
  });

  it("rejects (422) a ```beacon-block feature (ExitPlanMode path) missing the keys", async () => {
    const markdown = [
      "# Plan",
      "Some prose.",
      "```beacon",
      JSON.stringify({ features: [{ title: "From block" }] }),
      "```",
    ].join("\n");
    const res = await planPost(reqJson("http://test/api/plan", { description: "block plan", markdown }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("From block");
  });
});

describe("POST /api/plan re-processes a same-plan resume when the board failed to render", () => {
  beforeEach(async () => {
    await annotationsDelete(emptyReq());
    await planDelete(emptyReq());
    rmSync(join(dataDir(), "plan-verdict.json"), { force: true });
  });

  // A block that yields NOTHING (no recognizable tables/features) leaves an empty board. Re-
  // pushing the identical plan must re-process (not short-circuit as a resume) so a fixed
  // extraction can populate it — and any obsolete "where are the tables?" feedback resets.
  it("re-processes (resets feedback) on an identical re-push when the board is empty but the plan wants one", async () => {
    const md = ["# Plan", "prose", "```beacon", JSON.stringify({ features: [{ title: "X", cluster: "DATA", priority: 1 }] }), "```"].join("\n");
    // Round 1 renders the feature board fine.
    await planPost(reqJson("http://test/api/plan", { description: "p", markdown: md }));
    const draftCount = async () =>
      (
        await db
          .select({ n: count() })
          .from(node)
          .where(and(eq(node.source, "DRAFT"), eq(node.view, "ROADMAP")))
      )[0].n;
    let nodes = await draftCount();
    expect(nodes).toBe(1);

    // Simulate a prior FAILED extraction: wipe the persisted board but keep the same plan-meta hash.
    await db.delete(node).where(and(eq(node.source, "DRAFT"), eq(node.view, "ROADMAP")));
    // User left feedback meanwhile.
    await annotationsPost(reqJson("http://test/api/plan/annotations", { annotations: [], globalComment: "where are the tables?" }));

    // Identical re-push: board is empty + plan wants a board → must re-process and repopulate it.
    await planPost(reqJson("http://test/api/plan", { description: "p", markdown: md }));
    nodes = await draftCount();
    expect(nodes).toBe(1); // board re-rendered
    // The obsolete feedback was reset (fresh round).
    const ann = (await (await annotationsGet(emptyReq())).json()) as { globalComment: string; submitted: boolean };
    expect(ann.globalComment).toBe("");
    expect(ann.submitted).toBe(false);
  });

  it("still RESUMES (preserves feedback) on an identical re-push when the board IS rendered", async () => {
    const md = ["# Plan", "prose", "```beacon", JSON.stringify({ features: [{ title: "Y", cluster: "DATA", priority: 1 }] }), "```"].join("\n");
    await planPost(reqJson("http://test/api/plan", { description: "q", markdown: md }));
    await annotationsPost(reqJson("http://test/api/plan/annotations", { annotations: [], globalComment: "looks good but rename" }));
    // Identical re-push while the board is rendered → resume → feedback preserved.
    const res = await planPost(reqJson("http://test/api/plan", { description: "q", markdown: md }));
    expect((await res.json()).resumed).toBe(true);
    const ann = (await (await annotationsGet(emptyReq())).json()) as { globalComment: string };
    expect(ann.globalComment).toBe("looks good but rename");
  });
});
