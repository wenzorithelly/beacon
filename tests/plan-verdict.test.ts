import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// Isolate the per-workspace data dir into a throwaway tmp dir so each test starts clean.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-plan-verdict-"));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node, dbTable } from "@/lib/drizzle/schema";
import { dataDir } from "@/lib/project";
import { readDraftDoc } from "@/lib/draft-store";
import { listHistory } from "@/lib/plan-history";
import { resolvePlanVerdict } from "@/lib/plan-resolve";
import { writePlanVerdict } from "@/lib/plan-verdict";
import { writeStoredAnnotations } from "@/lib/plan-annotations-store";
import { writeJsonAtomic } from "@/lib/atomic-write";
import { POST as planPost, DELETE as planDelete } from "@/app/api/plan/route";
import { POST as approvePost } from "@/app/api/plan/approve/route";
import { POST as draftApprovePost } from "@/app/api/draft/approve/route";
import { DELETE as draftDelete } from "@/app/api/draft/route";
import { POST as annotationsPost } from "@/app/api/plan/annotations/route";

function postReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function bareReq(): Request {
  return new Request("http://test/x");
}
function planReq(body: unknown): Request {
  return postReq("http://test/api/plan", body);
}

const STATE_FILES = [
  "draft.json",
  "draft-verdict.json",
  "plan-verdict.json",
  "plan-meta.json",
  "plan-annotations-current.json",
];

async function clean() {
  for (const f of STATE_FILES) rmSync(join(dataDir(), f), { force: true });
  rmSync(join(dataDir(), "plans"), { recursive: true, force: true });
  await db.delete(node).where(eq(node.view, "ROADMAP"));
  await db.delete(dbTable);
}

const tableDraft = {
  tables: [
    { name: "vt_orgs", columns: [{ name: "id", type: "UUID", isPk: true, nullable: false }] },
  ],
  relations: [],
  endpoints: [],
};

describe("resolvePlanVerdict — D1: approve is never misread as discard", () => {
  beforeEach(clean);

  it("resolves a FEATURES-ONLY approve as approved (the headline bug)", async () => {
    await planPost(
      planReq({ description: "feature plan", features: [{ title: "Org mgmt", cluster: "AUTH", priority: 1 }] }),
    );
    expect((await resolvePlanVerdict()).kind).toBe("pending");

    await approvePost(bareReq());
    const v = await resolvePlanVerdict();
    expect(v.kind).toBe("approved");
  });

  it("resolves a MARKDOWN-ONLY approve as approved", async () => {
    await planPost(planReq({ description: "md plan", markdown: "# Plan\n\nPure prose, no block." }));
    expect((await resolvePlanVerdict()).kind).toBe("pending");

    await approvePost(bareReq());
    expect((await resolvePlanVerdict()).kind).toBe("approved");
  });
});

describe("resolvePlanVerdict — precedence", () => {
  beforeEach(clean);

  it("submitted non-empty feedback wins over an approved verdict", async () => {
    writePlanVerdict({ proposedAt: 1, status: "approved", summary: "s", decidedAt: 1 });
    writeStoredAnnotations({
      annotations: [{ id: "a", excerpt: "x", comment: "please change this" }],
      globalComment: "",
      submitted: true,
    });
    expect((await resolvePlanVerdict()).kind).toBe("feedback");
  });

  it("an empty submit falls through to the approved verdict", async () => {
    writePlanVerdict({ proposedAt: 1, status: "approved", summary: "s", decidedAt: 1 });
    writeStoredAnnotations({ annotations: [], globalComment: "", submitted: true });
    expect((await resolvePlanVerdict()).kind).toBe("approved");
  });
});

describe("D4 — every button archives once + cleans up identically", () => {
  beforeEach(clean);

  async function expectResolvedOnce(action: () => Promise<unknown>) {
    const before = listHistory().length;
    await action();
    expect(listHistory().length).toBe(before + 1);
    expect(readDraftDoc()).toBeNull();
    expect(existsSync(join(dataDir(), "plan-meta.json"))).toBe(false);
    expect(existsSync(join(dataDir(), "plan-annotations-current.json"))).toBe(false);
  }

  it("/api/plan/approve (unified Approve)", async () => {
    await planPost(planReq({ description: "p", draft: tableDraft }));
    await expectResolvedOnce(() => approvePost(bareReq()));
    expect((await resolvePlanVerdict()).kind).toBe("approved");
  });

  it("/api/draft/approve (the /db Aprovar) — sends the edited doc", async () => {
    await planPost(planReq({ description: "p", draft: tableDraft }));
    const doc = readDraftDoc();
    await expectResolvedOnce(() =>
      draftApprovePost(postReq("http://test/api/draft/approve", doc)),
    );
    expect((await resolvePlanVerdict()).kind).toBe("approved");
  });

  it("/api/plan DELETE (unified Discard)", async () => {
    await planPost(planReq({ description: "p", draft: tableDraft }));
    await expectResolvedOnce(() => planDelete(bareReq()));
    expect((await resolvePlanVerdict()).kind).toBe("discarded");
  });

  it("/api/draft DELETE (the /db Descartar)", async () => {
    await planPost(planReq({ description: "p", draft: tableDraft }));
    await expectResolvedOnce(() => draftDelete(bareReq()));
    expect((await resolvePlanVerdict()).kind).toBe("discarded");
  });
});

describe("D7 + resilience — fresh-round reset vs identical-resume", () => {
  beforeEach(clean);

  it("a REVISED (different) re-present resets the round — no stale-feedback replay", async () => {
    await planPost(planReq({ description: "r1", markdown: "# Plan A\n\nfirst draft" }));
    await annotationsPost(
      postReq("http://test/api/plan/annotations", {
        annotations: [{ id: "a", excerpt: "x", comment: "change it" }],
      }),
    );
    expect((await resolvePlanVerdict()).kind).toBe("feedback");

    // The agent revised → different markdown → fresh round.
    await planPost(planReq({ description: "r2", markdown: "# Plan B\n\nrevised draft" }));
    expect((await resolvePlanVerdict()).kind).toBe("pending");
  });

  it("an IDENTICAL re-push (crash/resume) preserves the submitted feedback", async () => {
    const plan = { description: "same", markdown: "# Same\n\nidentical body" };
    await planPost(planReq(plan));
    await annotationsPost(
      postReq("http://test/api/plan/annotations", {
        annotations: [{ id: "a", excerpt: "x", comment: "keep my feedback" }],
      }),
    );
    expect((await resolvePlanVerdict()).kind).toBe("feedback");

    await planPost(planReq(plan)); // same content hash → resume guard
    expect((await resolvePlanVerdict()).kind).toBe("feedback");
  });

  it("writeJsonAtomic leaves no .tmp behind", () => {
    const p = join(dataDir(), "atomic-probe.json");
    writeJsonAtomic(p, { ok: true });
    expect(existsSync(p)).toBe(true);
    expect(existsSync(`${p}.tmp`)).toBe(false);
  });
});
