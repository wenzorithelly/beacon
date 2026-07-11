import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-ask-deliver-route-"));

import { GET as askGet, POST as askPost } from "@/app/api/ask/route";
import { POST as deliverPost } from "@/app/api/ask/deliver/route";
import { readAskDelivery } from "@/lib/ask-delivery";
import { clearAskResolution, clearPendingAsk, readPendingAsk } from "@/lib/ask-store";
import { recordDelivererPresence } from "@/lib/deliverer-registry";

// The server-side backstop for the two-way ask bridge: clicking an option in Beacon only actually
// delivers when a live deliverer is registered — this is what /api/ask/deliver enforces even if a
// stale client somehow renders a clickable button anyway. Also covers GET /api/ask's new
// `delivererLive` field, which is what decides that clickability client-side.

function req(body: unknown) {
  return new Request("http://test/api/ask/deliver", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function pushQuestion() {
  const res = await askPost(
    new Request("http://test/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "question",
        question: {
          header: "DB",
          question: "Which database?",
          multiSelect: false,
          options: [{ label: "Postgres" }, { label: "SQLite" }],
        },
        mode: "mirror",
      }),
    }),
  );
  return (await res.json()) as { loop: boolean; id?: string };
}

const multiQuestions = [
  {
    header: "DB",
    question: "Which database?",
    multiSelect: false,
    options: [{ label: "Postgres" }, { label: "SQLite" }],
  },
  {
    header: "Cache",
    question: "Which cache?",
    multiSelect: false,
    options: [{ label: "Redis" }, { label: "None" }],
  },
  {
    header: "Deploy",
    question: "Where to deploy?",
    multiSelect: false,
    options: [{ label: "Vercel" }, { label: "Self-hosted" }],
  },
];

async function pushMultiQuestion() {
  const res = await askPost(
    new Request("http://test/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "question",
        question: multiQuestions[0],
        questions: multiQuestions,
        questionIndex: 0,
        mode: "mirror",
      }),
    }),
  );
  return (await res.json()) as { loop: boolean; id?: string };
}

// NOTE ON ORDERING: isDelivererLive() checks against the REAL wall clock (the route calls
// `isDelivererLive(Date.now())` internally, not an injectable time), and there is no "unregister" —
// only a 15s TTL expiry, far too slow for a test. So every "no live deliverer" case runs FIRST, in
// this describe block, BEFORE any test anywhere in the file calls recordDelivererPresence — once
// that happens once, the deliverer stays live (real time) for the rest of the run.

describe("GET /api/ask delivererLive + POST /api/ask/deliver — before any deliverer ever registers", () => {
  beforeEach(() => {
    clearPendingAsk();
    clearAskResolution();
  });

  it("GET /api/ask reports delivererLive: false", async () => {
    const res = await askGet(new Request("http://test/api/ask"));
    const body = (await res.json()) as { delivererLive: boolean };
    expect(body.delivererLive).toBe(false);
  });

  it("POST /api/ask/deliver rejects (409) when there is no live deliverer", async () => {
    const pushed = await pushQuestion();
    const res = await deliverPost(req({ id: pushed.id, selected: ["Postgres"] }));
    expect(res.status).toBe(409);
  });
});

describe("once a deliverer has registered", () => {
  beforeEach(() => {
    clearPendingAsk();
    clearAskResolution();
    recordDelivererPresence(Date.now());
  });

  it("GET /api/ask reports delivererLive: true", async () => {
    const res = await askGet(new Request("http://test/api/ask"));
    const body = (await res.json()) as { delivererLive: boolean };
    expect(body.delivererLive).toBe(true);
  });

  it("POST /api/ask/deliver rejects (409) when the id no longer names the pending ask", async () => {
    await pushQuestion();
    const res = await deliverPost(req({ id: "stale-id", selected: ["Postgres"] }));
    expect(res.status).toBe(409);
  });

  it("POST /api/ask/deliver accepts and records the delivery + flags the pending ask as delivered", async () => {
    const pushed = await pushQuestion();
    const res = await deliverPost(req({ id: pushed.id, selected: ["Postgres"] }));
    expect(res.status).toBe(200);
    expect(readAskDelivery()).toMatchObject({ askId: pushed.id, selected: ["Postgres"] });
    expect(readPendingAsk()?.deliveredAt).toBeGreaterThan(0);
  });

  it("POST /api/ask/deliver rejects a malformed body (400)", async () => {
    const res = await deliverPost(req({ id: "x" }));
    expect(res.status).toBe(400);
  });
});

// v2 multi-question: answering a non-final question ADVANCES the pending ask in place (same id,
// next question) instead of resolving it — see lib/ask-store.advancePendingAsk and the deliver
// route's contract comment. These all require a live deliverer, same as the block above.
describe("multi-question advance (POST /api/ask/deliver)", () => {
  beforeEach(() => {
    clearPendingAsk();
    clearAskResolution();
    recordDelivererPresence(Date.now());
  });

  it("answering question 0 advances the pending ask to question 1, same id, deliveredAt cleared", async () => {
    const pushed = await pushMultiQuestion();
    const res = await deliverPost(req({ id: pushed.id, selected: ["Postgres"], questionIndex: 0 }));
    expect(res.status).toBe(200);

    const advanced = readPendingAsk();
    expect(advanced?.id).toBe(pushed.id); // same tool call, same id
    expect(advanced?.questionIndex).toBe(1);
    expect(advanced?.question?.question).toBe("Which cache?");
    expect(advanced?.deliveredAt).toBeUndefined(); // cleared, so GET /api/ask doesn't sweep it early

    // The delivery record for question 0 is still written (a consumer types its pick).
    expect(readAskDelivery()).toMatchObject({
      askId: pushed.id,
      selected: ["Postgres"],
      questionIndex: 0,
    });
  });

  it("answering the LAST question resolves as usual (marks delivered, doesn't advance further)", async () => {
    const pushed = await pushMultiQuestion();
    await deliverPost(req({ id: pushed.id, selected: ["Postgres"], questionIndex: 0 }));
    await deliverPost(req({ id: pushed.id, selected: ["Redis"], questionIndex: 1 }));
    const res = await deliverPost(req({ id: pushed.id, selected: ["Vercel"], questionIndex: 2 }));
    expect(res.status).toBe(200);

    const pending = readPendingAsk();
    expect(pending?.id).toBe(pushed.id);
    expect(pending?.questionIndex).toBe(2); // no question 3 to advance to
    expect(pending?.deliveredAt).toBeGreaterThan(0); // resolved the same way a single-question ask is
    expect(readAskDelivery()).toMatchObject({ askId: pushed.id, selected: ["Vercel"], questionIndex: 2 });
  });

  it("rejects a stale questionIndex (409) instead of silently answering the wrong question", async () => {
    const pushed = await pushMultiQuestion();
    await deliverPost(req({ id: pushed.id, selected: ["Postgres"], questionIndex: 0 })); // advances to index 1

    // Client still thinks it's answering question 0 (e.g. a stale double-submit) — reject.
    const res = await deliverPost(req({ id: pushed.id, selected: ["SQLite"], questionIndex: 0 }));
    expect(res.status).toBe(409);
    expect(readPendingAsk()?.questionIndex).toBe(1); // unchanged by the rejected submit
  });
});
