import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Drive the real /api/lesson route handlers through the full blocking loop (push → ask → answer →
// save / close), exactly as the beacon_explain MCP tool does — on a provisioned workspace so the
// bumpVersion() writes land somewhere real.
const HOME = mkdtempSync(join(tmpdir(), "beacon-explain-"));
process.env.BEACON_HOME = HOME;

const { addWorkspace, idForPath, ensureWorkspaceDb } = await import("@/lib/workspaces");
const lessonRoute = await import("@/app/api/lesson/route");
const verdictRoute = await import("@/app/api/lesson/verdict/route");
const questionsRoute = await import("@/app/api/lesson/questions/route");
const saveRoute = await import("@/app/api/lesson/save/route");
const closeRoute = await import("@/app/api/lesson/close/route");

const WS = "/repos/lesson-loop";
const ID = idForPath(WS);

beforeAll(async () => {
  addWorkspace(WS);
  await ensureWorkspaceDb(ID);
}, 60_000);
afterAll(() => rmSync(HOME, { recursive: true, force: true }));

const req = (path: string, method: string, body?: unknown) =>
  new Request(`http://x${path}`, {
    method,
    headers: { "content-type": "application/json", "x-beacon-workspace": ID },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const baseLesson = () => ({
  title: "How a plan flows to /plan",
  topic: "explain the plan loop",
  narrative: "## Big picture\n\nThe agent pushes a plan via `bin/plan.ts` and blocks.",
  nodes: [
    { id: "n1", title: "ExitPlanMode", summary: "the plan hook", files: ["bin/plan.ts"] },
    { id: "n2", title: "/plan page", summary: "the review surface" },
  ],
  edges: [{ fromId: "n1", toId: "n2", verb: "routes to" }],
});

describe("beacon_explain loop", () => {
  it("runs push → pending → questions → answer → pending → save", async () => {
    // 1. push round one
    const pushed = await (await lessonRoute.POST(req("/api/lesson", "POST", baseLesson()))).json();
    expect(pushed.ok).toBe(true);

    // 2. no decision yet → pending
    expect((await (await verdictRoute.GET(req("/api/lesson/verdict", "GET"))).json()).kind).toBe(
      "pending",
    );

    // 3. user asks a node question and sends it
    const sent = await (
      await questionsRoute.POST(
        req("/api/lesson/questions", "POST", {
          questions: [
            { id: "q1", anchor: { kind: "node", nodeId: "n2" }, question: "why does it block?", askedAt: 1 },
          ],
        }),
      )
    ).json();
    expect(sent.ok).toBe(true);

    // 4. verdict flips to questions, with rendered markdown the agent answers
    const v = await (await verdictRoute.GET(req("/api/lesson/verdict", "GET"))).json();
    expect(v.kind).toBe("questions");
    expect(v.rendered).toContain("[q:q1]");
    expect(v.rendered).toContain('About "/plan page"'); // node title resolved
    expect(v.rendered).toContain("why does it block?");

    // 5. agent answers + re-pushes the same lesson
    const repushed = await (
      await lessonRoute.POST(
        req("/api/lesson", "POST", {
          ...baseLesson(),
          answers: [{ questionId: "q1", answer: "to wait for the user's verdict on disk" }],
        }),
      )
    ).json();
    expect(repushed.ok).toBe(true);
    expect(repushed.updatedAt).toBeGreaterThan(pushed.updatedAt);

    // 6. round buffer cleared → back to pending (not stuck re-returning the question)
    expect((await (await verdictRoute.GET(req("/api/lesson/verdict", "GET"))).json()).kind).toBe(
      "pending",
    );

    // 7. the answered Q&A is now on the live lesson
    const live = await (await lessonRoute.GET(req("/api/lesson", "GET"))).json();
    expect(live.lesson.questions).toHaveLength(1);
    expect(live.lesson.questions[0].answer).toContain("verdict on disk");

    // 8. save → verdict saved, loop ends
    const saved = await (await saveRoute.POST(req("/api/lesson/save", "POST"))).json();
    expect(saved.ok).toBe(true);
    const final = await (await verdictRoute.GET(req("/api/lesson/verdict", "GET"))).json();
    expect(final.kind).toBe("saved");
    expect(final.lessonId).toBe(saved.lessonId);

    // saving clears the live lesson
    expect((await (await lessonRoute.GET(req("/api/lesson", "GET"))).json()).lesson).toBeNull();
  }, 60_000);

  it("a fresh push clears a stale saved verdict; close ends without saving", async () => {
    await lessonRoute.POST(req("/api/lesson", "POST", baseLesson()));
    // The previous test left a saved verdict; the push must have cleared it → pending, not saved.
    expect((await (await verdictRoute.GET(req("/api/lesson/verdict", "GET"))).json()).kind).toBe(
      "pending",
    );
    await closeRoute.POST(req("/api/lesson/close", "POST"));
    expect((await (await verdictRoute.GET(req("/api/lesson/verdict", "GET"))).json()).kind).toBe(
      "closed",
    );
  }, 60_000);

  it("refuses an empty question submit", async () => {
    const res = await questionsRoute.POST(
      req("/api/lesson/questions", "POST", {
        questions: [{ id: "q9", anchor: { kind: "overall" }, question: "   ", askedAt: 1 }],
      }),
    );
    expect(res.status).toBe(400);
  });
});
