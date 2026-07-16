import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LESSON_LISTENER_TTL_MS,
  clearLessonListener,
  heartbeatLessonListener,
  holdLessonListener,
} from "@/lib/lesson-listener";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "beacon-lesson-listener-"));
  process.env.BEACON_DATA_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.BEACON_DATA_DIR;
});

describe("lesson listener heartbeat", () => {
  it("records concurrent listeners and clears only the caller that ended", () => {
    heartbeatLessonListener("agent-a", 100);
    heartbeatLessonListener("agent-b", 200);
    clearLessonListener("agent-a");
    const file = JSON.parse(readFileSync(join(dir, "lesson-listener.json"), "utf8"));
    expect(file.listeners).toEqual({ "agent-b": { ts: 200 } });
  });

  it("prunes a listener only after its fallback TTL", () => {
    heartbeatLessonListener("stale", 1);
    heartbeatLessonListener("fresh", 1 + LESSON_LISTENER_TTL_MS);
    const file = JSON.parse(readFileSync(join(dir, "lesson-listener.json"), "utf8"));
    expect(file.listeners).toEqual({ fresh: { ts: 1 + LESSON_LISTENER_TTL_MS } });
  });

  it("keeps a handoff lease after the MCP call returned its questions", () => {
    holdLessonListener("agent-a", 100);
    const file = JSON.parse(readFileSync(join(dir, "lesson-listener.json"), "utf8"));
    expect(file.listeners["agent-a"].handoffUntil).toBeGreaterThan(100);
  });
});
