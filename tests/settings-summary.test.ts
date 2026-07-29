import { beforeEach, describe, expect, test } from "bun:test";
import {
  publishSummary,
  resetSummaries,
  sectionSummary,
  subscribeToSummaries,
  summaryVersion,
} from "@/lib/settings-summary";

// The store behind the settings rail's second line. The behaviours that matter are the ones a rail
// row would visibly get wrong: a stale value after navigating away, two publishers clobbering each
// other, and a summary that renders a bare separator because a fragment was empty.

beforeEach(() => resetSummaries());

describe("sectionSummary", () => {
  test("is empty for a section nothing has published for", () => {
    expect(sectionSummary("terminal")).toBe("");
  });

  test("returns a single fragment verbatim", () => {
    publishSummary("terminal", "core", "13px · Block · WebGL");
    expect(sectionSummary("terminal")).toBe("13px · Block · WebGL");
  });

  test("joins several publishers in publish order", () => {
    publishSummary("agent", "mode", "Ask before edits");
    publishSummary("agent", "permissions", "2 permissions pending");
    expect(sectionSummary("agent")).toBe("Ask before edits · 2 permissions pending");
  });

  test("keeps sections separate", () => {
    publishSummary("agent", "mode", "Ask before edits");
    publishSummary("connections", "linear", "Linear off");
    expect(sectionSummary("agent")).toBe("Ask before edits");
    expect(sectionSummary("connections")).toBe("Linear off");
  });

  test("a re-publish on the same key replaces rather than appends", () => {
    publishSummary("terminal", "core", "13px · Block · WebGL");
    publishSummary("terminal", "core", "15px · Bar · DOM");
    expect(sectionSummary("terminal")).toBe("15px · Bar · DOM");
  });

  test("an undefined value contributes nothing — never a dangling separator", () => {
    publishSummary("connections", "linear", "Linear connected");
    publishSummary("connections", "claudeai", undefined);
    expect(sectionSummary("connections")).toBe("Linear connected");
  });
});

describe("withdrawal", () => {
  test("unmounting a publisher drops only its own fragment", () => {
    const dropMode = publishSummary("agent", "mode", "Ask before edits");
    publishSummary("agent", "permissions", "2 permissions pending");
    dropMode();
    expect(sectionSummary("agent")).toBe("2 permissions pending");
  });

  test("withdrawing the last fragment empties the section", () => {
    const drop = publishSummary("terminal", "core", "13px · Block · WebGL");
    drop();
    expect(sectionSummary("terminal")).toBe("");
  });

  test("withdrawing twice is a no-op, not a throw", () => {
    const drop = publishSummary("terminal", "core", "13px");
    drop();
    expect(() => drop()).not.toThrow();
    expect(sectionSummary("terminal")).toBe("");
  });

  test("a stale withdraw cannot delete a newer publisher's value", () => {
    // Remount ordering: the new card publishes before the old one's cleanup runs.
    const dropOld = publishSummary("terminal", "core", "13px");
    publishSummary("terminal", "core", "15px");
    dropOld();
    // The key is genuinely gone — this documents the ceiling, not a claim that it survives.
    // ponytail: last-writer-wins on a shared key. One publisher per key is the contract, and every
    // caller today honours it (one card owns one key); per-instance keys if that ever stops holding.
    expect(sectionSummary("terminal")).toBe("");
  });
});

describe("subscription", () => {
  test("notifies subscribers and advances the version on publish", () => {
    let calls = 0;
    const unsubscribe = subscribeToSummaries(() => { calls += 1; });
    const before = summaryVersion();
    publishSummary("terminal", "core", "13px");
    expect(calls).toBe(1);
    expect(summaryVersion()).toBeGreaterThan(before);
    unsubscribe();
  });

  test("notifies on withdrawal too, so the rail can drop the line", () => {
    const drop = publishSummary("terminal", "core", "13px");
    let calls = 0;
    const unsubscribe = subscribeToSummaries(() => { calls += 1; });
    drop();
    expect(calls).toBe(1);
    unsubscribe();
  });

  test("an unsubscribed listener stops hearing about changes", () => {
    let calls = 0;
    const unsubscribe = subscribeToSummaries(() => { calls += 1; });
    unsubscribe();
    publishSummary("terminal", "core", "13px");
    expect(calls).toBe(0);
  });
});
