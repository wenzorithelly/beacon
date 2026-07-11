import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  type AgentStatusFile,
  mergeAgentStatus,
  recordAgentStatus,
  resumeWaitingSessions,
} from "@/lib/agent-status";
import { dataDirFor, idForPath } from "@/lib/workspaces";

// Pure merge/prune core — the disk contract's beating heart. Unit-tested exhaustively per the spec:
// merge/upsert/prune logic, state transitions, unknown-session prune, terminalId null vs set, 12h
// expiry boundary.

const HOUR = 60 * 60 * 1000;
const TWELVE_HOURS = 12 * HOUR;

describe("mergeAgentStatus — pure core", () => {
  it("upserts a brand-new session into an empty (null) file", () => {
    const next = mergeAgentStatus(null, {
      sessionId: "s1",
      state: "working",
      terminalId: null,
      cwd: "/repo",
      now: 1000,
    });
    expect(next).toEqual({
      sessions: {
        s1: { state: "working", terminalId: null, ts: 1000, cwd: "/repo" },
      },
    });
  });

  it("upserts into an existing file without touching other sessions", () => {
    const prev: AgentStatusFile = {
      sessions: {
        s1: { state: "working", terminalId: null, ts: 1000, cwd: "/repo" },
      },
    };
    const next = mergeAgentStatus(prev, {
      sessionId: "s2",
      state: "waiting",
      terminalId: "term-1",
      cwd: "/repo2",
      now: 2000,
    });
    expect(next.sessions.s1).toEqual({ state: "working", terminalId: null, ts: 1000, cwd: "/repo" });
    expect(next.sessions.s2).toEqual({
      state: "waiting",
      terminalId: "term-1",
      ts: 2000,
      cwd: "/repo2",
    });
  });

  it("last write wins: re-merging the SAME session id overwrites its prior state", () => {
    const prev = mergeAgentStatus(null, {
      sessionId: "s1",
      state: "working",
      terminalId: null,
      cwd: "/repo",
      now: 1000,
    });
    const next = mergeAgentStatus(prev, {
      sessionId: "s1",
      state: "done",
      terminalId: null,
      cwd: "/repo",
      now: 5000,
    });
    expect(next.sessions.s1).toEqual({ state: "done", terminalId: null, ts: 5000, cwd: "/repo" });
    expect(Object.keys(next.sessions)).toEqual(["s1"]);
  });

  it("walks every state transition: working -> waiting -> working -> done", () => {
    let file: AgentStatusFile | null = null;
    const states = ["working", "waiting", "working", "done"] as const;
    let now = 0;
    for (const state of states) {
      now += 100;
      file = mergeAgentStatus(file, { sessionId: "s1", state, terminalId: null, cwd: "/repo", now });
      expect(file.sessions.s1.state).toBe(state);
      expect(file.sessions.s1.ts).toBe(now);
    }
  });

  it("terminalId null when absent, preserved verbatim when set", () => {
    const withNull = mergeAgentStatus(null, {
      sessionId: "s1",
      state: "working",
      terminalId: null,
      cwd: "/repo",
      now: 1000,
    });
    expect(withNull.sessions.s1.terminalId).toBeNull();

    const withId = mergeAgentStatus(null, {
      sessionId: "s2",
      state: "working",
      terminalId: "beacon-term-abc",
      cwd: "/repo",
      now: 1000,
    });
    expect(withId.sessions.s2.terminalId).toBe("beacon-term-abc");
  });

  it("prunes a session strictly older than 12h on every write", () => {
    const prev: AgentStatusFile = {
      sessions: {
        stale: { state: "done", terminalId: null, ts: 0, cwd: "/repo" },
      },
    };
    const next = mergeAgentStatus(prev, {
      sessionId: "fresh",
      state: "working",
      terminalId: null,
      cwd: "/repo",
      now: TWELVE_HOURS + 1,
    });
    expect(next.sessions.stale).toBeUndefined();
    expect(next.sessions.fresh).toBeDefined();
  });

  it("12h boundary: exactly 12h old is pruned, 1ms under 12h survives", () => {
    const now = TWELVE_HOURS + 1000;
    const prev: AgentStatusFile = {
      sessions: {
        exactlyStale: { state: "done", terminalId: null, ts: now - TWELVE_HOURS, cwd: "/repo" },
        justUnder: { state: "done", terminalId: null, ts: now - TWELVE_HOURS + 1, cwd: "/repo" },
      },
    };
    const next = mergeAgentStatus(prev, {
      sessionId: "other",
      state: "working",
      terminalId: null,
      cwd: "/repo",
      now,
    });
    expect(next.sessions.exactlyStale).toBeUndefined();
    expect(next.sessions.justUnder).toBeDefined();
  });

  it("unknown/multiple stale sessions are all pruned, leaving only the fresh + upserted ones", () => {
    const prev: AgentStatusFile = {
      sessions: {
        a: { state: "done", terminalId: null, ts: 0, cwd: "/repo" },
        b: { state: "waiting", terminalId: "t1", ts: 1, cwd: "/repo" },
        c: { state: "working", terminalId: null, ts: TWELVE_HOURS + 500, cwd: "/repo" },
      },
    };
    const next = mergeAgentStatus(prev, {
      sessionId: "d",
      state: "done",
      terminalId: null,
      cwd: "/repo",
      now: TWELVE_HOURS + 1000,
    });
    expect(Object.keys(next.sessions).sort()).toEqual(["c", "d"]);
  });

  it("re-upserting the same session refreshes its ts, keeping it alive past the old cutoff", () => {
    let file = mergeAgentStatus(null, {
      sessionId: "s1",
      state: "working",
      terminalId: null,
      cwd: "/repo",
      now: 0,
    });
    // Touch it again just before the original ts would've aged out relative to a later prune.
    file = mergeAgentStatus(file, {
      sessionId: "s1",
      state: "working",
      terminalId: null,
      cwd: "/repo",
      now: TWELVE_HOURS - 1,
    });
    const next = mergeAgentStatus(file, {
      sessionId: "s2",
      state: "working",
      terminalId: null,
      cwd: "/repo",
      now: TWELVE_HOURS + 500,
    });
    // s1's ts was refreshed to TWELVE_HOURS - 1, so at now = TWELVE_HOURS + 500 it's only
    // ~501ms old — well within the window — while an un-refreshed session from ts=0 would be pruned.
    expect(next.sessions.s1).toBeDefined();
    expect(next.sessions.s2).toBeDefined();
  });
});

// The answer-landed flip: when an ask settles as answered (delivered Beacon pick, or the transcript
// showing the picker answered), no hook fires to say "the wait is over" — this is what releases the
// desktop attention pill's "Needs input" instead of it sticking until turn end.
describe("resumeWaitingSessions — pure core", () => {
  it("flips every waiting session to working with a fresh ts, leaving others verbatim", () => {
    const prev: AgentStatusFile = {
      sessions: {
        asking: { state: "waiting", terminalId: "t1", ts: 1000, cwd: "/repo" },
        busy: { state: "working", terminalId: null, ts: 900, cwd: "/repo" },
        finished: { state: "done", terminalId: null, ts: 800, cwd: "/repo" },
      },
    };
    const next = resumeWaitingSessions(prev, 5000)!;
    expect(next.sessions.asking).toEqual({ state: "working", terminalId: "t1", ts: 5000, cwd: "/repo" });
    expect(next.sessions.busy).toEqual(prev.sessions.busy);
    expect(next.sessions.finished).toEqual(prev.sessions.finished);
  });

  it("returns null when nothing is waiting (no write needed) or the file is empty/missing", () => {
    expect(resumeWaitingSessions(null, 5000)).toBeNull();
    expect(resumeWaitingSessions({ sessions: {} }, 5000)).toBeNull();
    expect(
      resumeWaitingSessions(
        { sessions: { s1: { state: "working", terminalId: null, ts: 1, cwd: "/r" } } },
        5000,
      ),
    ).toBeNull();
  });
});

describe("recordAgentStatus — IO wrapper", () => {
  let cwd: string;
  let prevTerminalId: string | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "beacon-agent-status-repo-"));
    prevTerminalId = process.env.BEACON_TERMINAL_ID;
    delete process.env.BEACON_TERMINAL_ID;
  });

  afterEach(() => {
    if (prevTerminalId === undefined) delete process.env.BEACON_TERMINAL_ID;
    else process.env.BEACON_TERMINAL_ID = prevTerminalId;
  });

  function readWritten(): AgentStatusFile {
    const id = idForPath(cwd); // non-git temp dir → repoRootFrom falls back to cwd itself
    return JSON.parse(readFileSync(join(dataDirFor(id), "agent-status.json"), "utf8"));
  }

  it("writes the disk contract shape for a fresh workspace", () => {
    recordAgentStatus(cwd, "sess-1", "working");
    const file = readWritten();
    expect(file.sessions["sess-1"].state).toBe("working");
    expect(file.sessions["sess-1"].cwd).toBe(cwd);
    expect(file.sessions["sess-1"].terminalId).toBeNull();
    expect(typeof file.sessions["sess-1"].ts).toBe("number");
  });

  it("reads BEACON_TERMINAL_ID from env when present", () => {
    process.env.BEACON_TERMINAL_ID = "term-xyz";
    recordAgentStatus(cwd, "sess-1", "waiting");
    expect(readWritten().sessions["sess-1"].terminalId).toBe("term-xyz");
  });

  it("merges a second write for a different session into the same file", () => {
    recordAgentStatus(cwd, "sess-1", "working");
    recordAgentStatus(cwd, "sess-2", "done");
    const file = readWritten();
    expect(file.sessions["sess-1"]).toBeDefined();
    expect(file.sessions["sess-2"].state).toBe("done");
  });

  it("is a no-op (never throws) when sessionId is empty", () => {
    expect(() => recordAgentStatus(cwd, "", "working")).not.toThrow();
  });
});
