import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

const DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-ask-answered-"));
process.env.BEACON_DATA_DIR = DATA_DIR;

import { GET as askGet, POST as askPost } from "@/app/api/ask/route";
import { POST as answeredPost } from "@/app/api/ask/answered/route";
import type { AgentStatusFile } from "@/lib/agent-status";
import {
  askHash,
  clearAskResolution,
  clearPendingAsk,
  markAskDelivered,
  type PendingAsk,
  pushAsk,
} from "@/lib/ask-store";
import { ASK_DELIVERED_CLEAR_MS, MIRROR_TTL_MS } from "@/lib/constants";

// The bug this fixes (owner-reported): a question answered in the TERMINAL kept showing on /plan's
// mirror "long after" the answer landed, because the only clear signals were the transcript scan
// (unreliable — some sessions never flush their .jsonl to disk) and a 30-min TTL backstop. POST
// /api/ask/answered is the new PRIMARY signal: bin/ask.ts's PostToolUse:AskUserQuestion leg calls it
// with the tool call's `tool_use_id`, and it clears the matching mirror immediately — see
// lib/ask-store.resolveAskByToolUseId. The transcript scan / deliveredAt / TTL all stay as backstops.

const question = {
  header: "DB",
  question: "Which database?",
  multiSelect: false,
  options: [{ label: "Postgres" }, { label: "SQLite" }],
};

const statusPath = join(DATA_DIR, "agent-status.json");

function req(body: unknown) {
  return new Request("http://test/api/ask/answered", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function pushMirror(toolUseId?: string, q: typeof question = question): Promise<string> {
  const res = await askPost(
    new Request("http://test/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "question", question: q, mode: "mirror", toolUseId }),
    }),
  );
  const body = (await res.json()) as { loop: boolean; id?: string };
  return body.id!;
}

async function currentAsk(): Promise<PendingAsk | null> {
  const res = await askGet(new Request("http://test/api/ask"));
  return ((await res.json()) as { ask: PendingAsk | null }).ask;
}

function seedWaitingStatus() {
  const file: AgentStatusFile = {
    sessions: {
      "sess-asking": { state: "waiting", terminalId: "term-1", ts: Date.now(), cwd: "/repo" },
    },
  };
  writeFileSync(statusPath, JSON.stringify(file));
}

const readStatus = (): AgentStatusFile => JSON.parse(readFileSync(statusPath, "utf8"));

beforeEach(() => {
  clearPendingAsk();
  clearAskResolution();
});

describe("POST /api/ask/answered", () => {
  it("clears the mirror by tool_use_id and flips waiting → working", async () => {
    seedWaitingStatus();
    await pushMirror("toolu_abc");

    const res = await answeredPost(req({ toolUseId: "toolu_abc" }));
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toEqual({ ok: true });

    expect(await currentAsk()).toBeNull(); // mirror gone immediately — no transcript/TTL wait needed
    expect(readStatus().sessions["sess-asking"].state).toBe("working"); // pill releases
  });

  it("resolves the WHOLE multi-question ask on one PostToolUse event (Claude Code fires it once, after every question in the tool call is answered)", async () => {
    seedWaitingStatus();
    const multiQuestions = [
      question,
      { ...question, header: "Cache", question: "Which cache?", options: [{ label: "Redis" }, { label: "None" }] },
    ];
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
          toolUseId: "toolu_multi",
        }),
      }),
    );
    await res.json();

    // Answering question 2 in the terminal never runs app/api/ask/deliver's advance step (that's
    // the Beacon-click path only — see lib/ask-store's known-limitation note), so the mirror is
    // still parked on question 1 when the tool call as a whole completes.
    expect((await currentAsk())?.questionIndex).toBe(0);

    await answeredPost(req({ toolUseId: "toolu_multi" }));
    expect(await currentAsk()).toBeNull(); // the entire ask is gone, not just advanced
  });

  it("is a safe no-op (200) for an unknown toolUseId — never a 500", async () => {
    await pushMirror("toolu_real");
    const res = await answeredPost(req({ toolUseId: "toolu_does_not_exist" }));
    expect(res.status).toBe(200);
    expect((await currentAsk())?.toolUseId).toBe("toolu_real"); // untouched
  });

  it("is a safe no-op (200) when there is nothing pending at all", async () => {
    const res = await answeredPost(req({ toolUseId: "anything" }));
    expect(res.status).toBe(200);
  });

  it("rejects a malformed body (400), still never a 500", async () => {
    const res = await answeredPost(req({}));
    expect(res.status).toBe(400);
  });

  it("leaves the deliveredAt auto-clear path behaving exactly as before", async () => {
    const id = await pushMirror();
    markAskDelivered(id, Date.now() - ASK_DELIVERED_CLEAR_MS - 1);
    expect(await currentAsk()).toBeNull();
  });

  it("leaves the TTL backstop behaving exactly as before, for an ask predating toolUseId", async () => {
    // No toolUseId at all — the shape a mirror pushed before this field existed still has. It must
    // still expire on the TTL backstop; resolveAskByToolUseId only ever ADDS a clear path, never
    // removes the old ones.
    pushAsk(
      { kind: "question", hash: askHash("question", question), question, mode: "mirror" },
      Date.now() - MIRROR_TTL_MS - 1,
    );
    expect(await currentAsk()).toBeNull();
  });
});
