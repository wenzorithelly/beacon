import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// Isolate the per-workspace data dir so each test starts clean.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-plan-round-"));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { POST as planPost, DELETE as planDelete } from "@/app/api/plan/route";
import { POST as annotationsPost } from "@/app/api/plan/annotations/route";
import { readDraftDoc } from "@/lib/draft-store";
import { getFeatureDraft } from "@/lib/feature-design";
import { readPlanMeta } from "@/lib/plan-meta";
import { extractBeaconBlock } from "@/lib/plan-block";
import { synthesizePlanMarkdown } from "@/lib/plan-markdown";

// THE ROUND RULE (app/api/plan/route.ts): a push states the WHOLE proposal, so every content
// channel it omits — prose, roadmap features, DB draft — is cleared rather than inherited.
//
// The bug this guards (owner, 2026-08-04, reported as the worst possible failure): an agent
// revised a plan, re-proposed it, and /plan kept rendering the FIRST version. The three channels
// were written independently — `if (draftInput…) writeProposal()`, `if (featureInput…)
// persistFeatureDraft()`, `markdown: hasMarkdown ? prose : prevMeta.markdown` — with no `else`,
// so anything the revision did not restate silently survived from the previous round and rendered
// beside the new content as if it were one plan. The reviewer approves what the agent is no longer
// proposing, the agent's revision is invisible, and the only rational move left is to bypass
// Beacon — which is exactly what happened.
//
// These assert on the state /plan renders from: app/plan/page.tsx reads readDraftDoc() for the DB
// board, the DRAFT ROADMAP nodes for the map, and plan-meta's markdown (block-stripped) falling
// back to synthesizePlanMarkdown for the annotation panel. `planProse()` below mirrors that exact
// resolution so a stale-prose regression fails here and not only in the browser.

const req = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const planReq = (body: unknown) => req("http://test/api/plan", body);
const emptyReq = () => new Request("http://test/api/plan");

const feature = (title: string, tag: string) => ({
  title,
  description: `${tag} — a card body long enough to clear the eighty-character minimum the feature rules enforce.`,
  category: "DATA",
  priority: 1,
});
const tableDraft = (name: string) => ({
  tables: [{ name, columns: [{ name: "id", type: "UUID", isPk: true, nullable: false }] }],
  relations: [],
  endpoints: [],
});
const withBlock = (tag: string, feat: string, table: string) =>
  `# Audit logging\n\n${tag} prose.\n\n\`\`\`beacon\n${JSON.stringify({
    features: [feature(feat, tag)],
    tables: tableDraft(table).tables,
  })}\n\`\`\`\n`;

/** Exactly what the annotation panel on /plan is handed (app/plan/page.tsx). */
async function planProse(): Promise<string> {
  const meta = readPlanMeta();
  const stripped = meta?.markdown ? extractBeaconBlock(meta.markdown).prose : undefined;
  return (
    stripped ??
    synthesizePlanMarkdown(meta?.description ?? "(no description)", readDraftDoc(), await getFeatureDraft())
  );
}
const draftTables = () => (readDraftDoc()?.tables ?? []).map((t) => t.name);
const draftFeatures = async () => (await getFeatureDraft()).features.map((f) => f.title);

/** The user reviews and submits feedback — what closes a round and makes the next push a revision. */
const submitFeedback = () =>
  annotationsPost(
    req("http://test/api/plan/annotations", {
      annotations: [],
      globalComment: "normalise this instead of one flat table",
    }),
  );

describe("a re-proposal replaces the round it revises", () => {
  beforeEach(async () => {
    await planDelete(emptyReq());
    await db.delete(node).where(eq(node.view, "ROADMAP"));
  });

  it("THE REPORTED BUG: after feedback, a prose-only revision leaves none of round 1 on the canvas", async () => {
    // Round 1 — the agent presents prose + a ```beacon board (the ExitPlanMode shape).
    expect((await planPost(planReq({ description: "Audit logging", markdown: withBlock("R1PROSE", "Audit v1", "audit_log") }))).status).toBe(200);
    expect(draftTables()).toEqual(["audit_log"]);
    expect(await draftFeatures()).toEqual(["Audit v1"]);

    // The user reviews on /plan and submits feedback. The round is now closed.
    await submitFeedback();

    // Round 2 — the agent answers that feedback with a revision whose scope no longer includes a
    // board. Everything the user reviews must now be round 2 and only round 2.
    expect((await planPost(planReq({ description: "Audit logging", markdown: "# Audit logging\n\nR2PROSE — dropped the schema entirely." }))).status).toBe(200);

    expect(await planProse()).toContain("R2PROSE");
    expect(await planProse()).not.toContain("R1PROSE");
    expect(draftTables()).toEqual([]);
    expect(await draftFeatures()).toEqual([]);
  });

  it("a revision that carries only prose clears the previous round's feature cards", async () => {
    await planPost(planReq({ description: "Audit logging", features: [feature("Audit v1", "R1FEATURE")] }));
    await submitFeedback();
    await planPost(planReq({ description: "Audit logging", markdown: "# Audit logging\n\nR2PROSE normalised." }));
    expect(await draftFeatures()).toEqual([]);
    expect(await planProse()).toContain("R2PROSE");
  });

  it("a revision that carries only features clears the previous round's tables", async () => {
    await planPost(planReq({ description: "Audit logging", draft: tableDraft("audit_log") }));
    await submitFeedback();
    await planPost(planReq({ description: "Audit logging", features: [feature("Audit v2", "R2FEATURE")] }));
    expect(draftTables()).toEqual([]);
    expect(await draftFeatures()).toEqual(["Audit v2"]);
  });

  it("a revision that carries only tables clears the previous round's feature cards", async () => {
    await planPost(planReq({ description: "Audit logging", features: [feature("Audit v1", "R1FEATURE")] }));
    await submitFeedback();
    await planPost(planReq({ description: "Audit logging", draft: tableDraft("audit_event") }));
    expect(await draftFeatures()).toEqual([]);
    expect(draftTables()).toEqual(["audit_event"]);
  });

  it("a board-only revision after feedback drops the previous round's prose instead of re-showing it", async () => {
    await planPost(planReq({ description: "Audit logging", markdown: "# Audit logging\n\nR1PROSE flat table." }));
    await submitFeedback();
    await planPost(planReq({ description: "Audit logging", features: [feature("Audit v2", "R2FEATURE")] }));
    const prose = await planProse();
    expect(prose).not.toContain("R1PROSE");
    expect(prose).toContain("R2FEATURE"); // synthesised from THIS round's board
  });

  it("a board push whose prior round already had a board never inherits that round's prose", async () => {
    await planPost(planReq({ description: "Audit logging", markdown: withBlock("R1PROSE", "Audit v1", "audit_log") }));
    await planPost(planReq({ description: "Audit logging", features: [feature("Audit v2", "R2FEATURE")], draft: tableDraft("audit_event") }));
    expect(await planProse()).not.toContain("R1PROSE");
    expect(draftTables()).toEqual(["audit_event"]);
    expect(await draftFeatures()).toEqual(["Audit v2"]);
  });

  // The one legitimate carry-forward, kept narrow on purpose (see the round rule's comment): the
  // ExitPlanMode hook pushes the prose and a follow-up beacon_propose_plan pushes only the board,
  // in the same unreviewed round. Guards against over-correcting the fix above.
  it("still composes ONE unreviewed round from a prose push plus a board-only push", async () => {
    await planPost(planReq({ description: "Harden the loop", markdown: "# Harden the loop\n\nRICHPROSE describing it in detail." }));
    await planPost(planReq({ description: "Harden the loop", features: [feature("Some feature", "BODY")] }));
    expect(await planProse()).toContain("RICHPROSE");
    expect(await draftFeatures()).toEqual(["Some feature"]);
  });

  it("…but not once the user has reviewed that round — then the same push is a revision", async () => {
    await planPost(planReq({ description: "Harden the loop", markdown: "# Harden the loop\n\nRICHPROSE describing it in detail." }));
    await submitFeedback();
    await planPost(planReq({ description: "Harden the loop", features: [feature("Some feature", "BODY")] }));
    expect(await planProse()).not.toContain("RICHPROSE");
  });

  it("an identical re-push still resumes: it clears nothing (a timed-out tool call retrying)", async () => {
    const push = { description: "Audit logging", markdown: withBlock("R1PROSE", "Audit v1", "audit_log") };
    await planPost(planReq(push));
    const res = await planPost(planReq(push));
    expect(await res.json()).toEqual({ ok: true, resumed: true });
    expect(draftTables()).toEqual(["audit_log"]);
    expect(await draftFeatures()).toEqual(["Audit v1"]);
  });

  it("an empty push is refused without disturbing the plan under review", async () => {
    await planPost(planReq({ description: "Audit logging", markdown: withBlock("R1PROSE", "Audit v1", "audit_log") }));
    const res = await planPost(planReq({ description: "Audit logging" }));
    expect(res.status).toBe(400);
    expect(draftTables()).toEqual(["audit_log"]);
    expect(await draftFeatures()).toEqual(["Audit v1"]);
  });
});
