import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

const DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-ask-delivered-clear-"));
process.env.BEACON_DATA_DIR = DATA_DIR;

import { GET as askGet, POST as askPost } from "@/app/api/ask/route";
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

// The stuck-mirror fix: a Beacon pick handed to a live deliverer (deliveredAt) is typed into the
// terminal within milliseconds — the delivery-ack IS the landing signal, so GET /api/ask clears the
// mirror a couple of seconds later WITHOUT the transcript watch (which can never fire for sessions
// whose transcript file Claude Code doesn't flush to disk — the "sent … waiting for it to land"
// card that used to sit until the 30-min TTL). The same clear flips the workspace's "waiting"
// agent-status back to "working", which is what releases the desktop attention pill.

const question = {
  header: "DB",
  question: "Which database?",
  multiSelect: false,
  options: [{ label: "Postgres" }, { label: "SQLite" }],
};

const statusPath = join(DATA_DIR, "agent-status.json");

async function pushMirror(q: typeof question = question): Promise<string> {
  const res = await askPost(
    new Request("http://test/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "question", question: q, mode: "mirror" }),
    }),
  );
  const body = (await res.json()) as { loop: boolean; id?: string };
  return body.id!;
}

async function currentAsk(): Promise<PendingAsk | null> {
  const res = await askGet(new Request("http://test/api/ask"));
  return ((await res.json()) as { ask: PendingAsk | null }).ask;
}

async function currentQueue(): Promise<PendingAsk[]> {
  const res = await askGet(new Request("http://test/api/ask"));
  return ((await res.json()) as { asks: PendingAsk[] }).asks;
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

describe("delivered mirror auto-clear (GET /api/ask)", () => {
  it("keeps the ask visible while the delivery is fresher than the grace window", async () => {
    const id = await pushMirror();
    markAskDelivered(id, Date.now()); // just delivered
    expect((await currentAsk())?.id).toBe(id); // still there — the modal shows its "sent" state
  });

  it("clears the ask once the delivery-ack is older than the grace window, and flips waiting → working", async () => {
    seedWaitingStatus();
    const id = await pushMirror();
    markAskDelivered(id, Date.now() - ASK_DELIVERED_CLEAR_MS - 1);

    expect(await currentAsk()).toBeNull(); // card gone on the next poll
    expect(await currentAsk()).toBeNull(); // and the store stays empty
    expect(readStatus().sessions["sess-asking"].state).toBe("working"); // pill releases
  });

  it("sweeps ONLY the settled ask — the ones queued behind it stay, and the next becomes the head", async () => {
    const first = await pushMirror();
    const second = await pushMirror({ ...question, question: "Which cache?" });
    expect(await currentQueue()).toHaveLength(2); // both visible to the panel's count

    markAskDelivered(first, Date.now() - ASK_DELIVERED_CLEAR_MS - 1);

    const left = await currentQueue();
    expect(left.map((a) => a.id)).toEqual([second]); // the other agent is still waiting, not dropped
    expect((await currentAsk())?.id).toBe(second); // panel moves on instead of going empty
  });

  it("sweeps a settled ask sitting BEHIND the head, so it never surfaces later as a dead question", async () => {
    const head = await pushMirror();
    const behind = await pushMirror({ ...question, question: "Which cache?" });
    markAskDelivered(behind, Date.now() - ASK_DELIVERED_CLEAR_MS - 1);

    expect((await currentQueue()).map((a) => a.id)).toEqual([head]);
  });

  it("TTL expiry still drops an abandoned mirror but does NOT fake an 'answer landed' status flip", async () => {
    seedWaitingStatus();
    // Push directly with an ancient createdAt — never delivered, never answered.
    pushAsk(
      { kind: "question", hash: askHash("question", question), question, mode: "mirror" },
      Date.now() - MIRROR_TTL_MS - 1,
    );

    expect(await currentAsk()).toBeNull(); // stale backstop drops it
    expect(readStatus().sessions["sess-asking"].state).toBe("waiting"); // no answer landed
  });
});
