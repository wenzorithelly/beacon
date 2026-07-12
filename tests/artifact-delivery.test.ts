import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

process.env.BEACON_HOME = mkdtempSync(join(tmpdir(), "beacon-artifact-delivery-"));

import {
  appendArtifactHistory,
  nextArtifactDelivery,
  nextArtifactHistory,
  readArtifactDelivery,
  readArtifactHistory,
  recordArtifactDelivery,
  writeArtifactDelivery,
} from "@/lib/artifact-delivery";
import { dataDirFor, idForPath } from "@/lib/workspaces";

// The other half of the artifact-publish bridge: `beacon artifact` (a bare CLI hook, no request
// context) writes straight to ~/.beacon/<workspaceId>/artifact-delivery.json, the desktop shell
// polls it. Same monotonic-seq shape as lib/ask-delivery so a consumer that's already seen seq N
// never re-acts on it.

describe("nextArtifactDelivery — pure core", () => {
  it("starts at seq 1 for the first delivery (no prior)", () => {
    expect(nextArtifactDelivery(null, "https://claude.ai/artifacts/abc", 100)).toEqual({
      seq: 1,
      url: "https://claude.ai/artifacts/abc",
      ts: 100,
    });
  });

  it("increments seq monotonically across deliveries", () => {
    const first = nextArtifactDelivery(null, "https://claude.ai/artifacts/a", 100);
    const second = nextArtifactDelivery(first, "https://claude.ai/artifacts/b", 200);
    expect(second).toEqual({ seq: 2, url: "https://claude.ai/artifacts/b", ts: 200 });
  });

  it("includes title only when given (omitted, never undefined-valued)", () => {
    const withTitle = nextArtifactDelivery(null, "https://claude.ai/artifacts/a", 100, "Bug dashboard");
    expect(withTitle.title).toBe("Bug dashboard");
    expect("title" in nextArtifactDelivery(null, "https://claude.ai/artifacts/a", 100)).toBe(false);
  });

  it("includes terminalId only when given", () => {
    const withTerm = nextArtifactDelivery(null, "https://claude.ai/artifacts/a", 100, undefined, "t-123");
    expect(withTerm.terminalId).toBe("t-123");
    expect("terminalId" in nextArtifactDelivery(null, "https://claude.ai/artifacts/a", 100)).toBe(false);
  });

  it("includes path + id only when given (the stable-copy fields)", () => {
    const withBoth = nextArtifactDelivery(
      null,
      "https://claude.ai/artifacts/a",
      100,
      undefined,
      undefined,
      "/home/.beacon/ws/artifacts/a.html",
      "a",
    );
    expect(withBoth.path).toBe("/home/.beacon/ws/artifacts/a.html");
    expect(withBoth.id).toBe("a");
    const withoutEither = nextArtifactDelivery(null, "https://claude.ai/artifacts/a", 100);
    expect("path" in withoutEither).toBe(false);
    expect("id" in withoutEither).toBe(false);
  });
});

describe("read/write round trip — IO wrapper", () => {
  it("persists a delivery to disk under the workspace's data dir and reads it back", () => {
    const ws = "ws-round-trip";
    const rec = writeArtifactDelivery(ws, "https://claude.ai/artifacts/abc", 1000, "Bug dashboard", "t-1");
    expect(rec).toEqual({
      seq: 1,
      url: "https://claude.ai/artifacts/abc",
      title: "Bug dashboard",
      ts: 1000,
      terminalId: "t-1",
    });
    expect(readArtifactDelivery(ws)).toEqual(rec);
    const onDisk = JSON.parse(readFileSync(join(dataDirFor(ws), "artifact-delivery.json"), "utf8"));
    expect(onDisk).toEqual(rec);
  });

  it("bumps seq on a second write for the SAME workspace instead of resetting it", () => {
    const ws = "ws-bump";
    writeArtifactDelivery(ws, "https://claude.ai/artifacts/a", 1000);
    const second = writeArtifactDelivery(ws, "https://claude.ai/artifacts/b", 2000);
    expect(second.seq).toBe(2);
    expect(readArtifactDelivery(ws)).toEqual(second);
  });

  it("keeps separate workspaces' seq counters independent", () => {
    const a = writeArtifactDelivery("ws-a", "https://claude.ai/artifacts/a", 1000);
    const b = writeArtifactDelivery("ws-b", "https://claude.ai/artifacts/b", 1000);
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(1);
  });

  it("returns null when nothing has been written for the workspace yet", () => {
    expect(readArtifactDelivery("ws-never-written")).toBeNull();
  });

  it("tolerates a garbage/corrupt file — treats it as absent instead of throwing", () => {
    const ws = "ws-garbage";
    mkdirSync(dataDirFor(ws), { recursive: true });
    writeFileSync(join(dataDirFor(ws), "artifact-delivery.json"), "{not json");
    expect(readArtifactDelivery(ws)).toBeNull();
    // A write right after a garbage file starts a fresh seq (prior file was unreadable).
    const rec = writeArtifactDelivery(ws, "https://claude.ai/artifacts/fresh", 5000);
    expect(rec.seq).toBe(1);
  });

  it("tolerates a well-formed JSON file missing required fields — treats it as absent", () => {
    const ws = "ws-missing-fields";
    mkdirSync(dataDirFor(ws), { recursive: true });
    writeFileSync(join(dataDirFor(ws), "artifact-delivery.json"), JSON.stringify({ seq: 3 }));
    expect(readArtifactDelivery(ws)).toBeNull();
  });

  it("persists path + id alongside the rest of the record and reads them back", () => {
    const ws = "ws-path-id";
    const rec = writeArtifactDelivery(
      ws,
      "https://claude.ai/artifacts/abc",
      1000,
      "Bug dashboard",
      "t-1",
      join(dataDirFor(ws), "artifacts", "abc.html"),
      "abc",
    );
    expect(rec.path).toBe(join(dataDirFor(ws), "artifacts", "abc.html"));
    expect(rec.id).toBe("abc");
    expect(readArtifactDelivery(ws)).toEqual(rec);
  });

  it("URL-only delivery (no path/id passed) omits both fields — same as today's MD-only artifacts", () => {
    const ws = "ws-url-only";
    const rec = writeArtifactDelivery(ws, "https://claude.ai/artifacts/abc", 1000, "Notes");
    expect("path" in rec).toBe(false);
    expect("id" in rec).toBe(false);
  });
});

describe("recordArtifactDelivery — IO wrapper (the hook's entry point)", () => {
  let cwd: string;
  let prevTerminalId: string | undefined;

  function setUp() {
    cwd = mkdtempSync(join(tmpdir(), "beacon-artifact-repo-"));
    prevTerminalId = process.env.BEACON_TERMINAL_ID;
    delete process.env.BEACON_TERMINAL_ID;
  }
  function tearDown() {
    if (prevTerminalId === undefined) delete process.env.BEACON_TERMINAL_ID;
    else process.env.BEACON_TERMINAL_ID = prevTerminalId;
  }
  function readWritten() {
    const id = idForPath(cwd); // non-git temp dir → repoRootFrom falls back to cwd itself
    return JSON.parse(readFileSync(join(dataDirFor(id), "artifact-delivery.json"), "utf8"));
  }

  it("resolves the workspace from cwd and writes the delivery, terminalId absent by default", () => {
    setUp();
    recordArtifactDelivery(cwd, "https://claude.ai/artifacts/abc", "Bug dashboard");
    const file = readWritten();
    expect(file.seq).toBe(1);
    expect(file.url).toBe("https://claude.ai/artifacts/abc");
    expect(file.title).toBe("Bug dashboard");
    expect("terminalId" in file).toBe(false);
    tearDown();
  });

  it("reads BEACON_TERMINAL_ID from env and passes it through when present", () => {
    setUp();
    process.env.BEACON_TERMINAL_ID = "t-xyz";
    recordArtifactDelivery(cwd, "https://claude.ai/artifacts/abc");
    expect(readWritten().terminalId).toBe("t-xyz");
    tearDown();
  });

  it("increments seq across successive calls for the same workspace", () => {
    setUp();
    recordArtifactDelivery(cwd, "https://claude.ai/artifacts/first");
    recordArtifactDelivery(cwd, "https://claude.ai/artifacts/second");
    const file = readWritten();
    expect(file.seq).toBe(2);
    expect(file.url).toBe("https://claude.ai/artifacts/second");
    tearDown();
  });

  it("is a no-op (never throws) for a cwd that doesn't exist on disk", () => {
    setUp();
    expect(() =>
      recordArtifactDelivery("/definitely/not/a/real/path/xyz", "https://claude.ai/artifacts/x"),
    ).not.toThrow();
    tearDown();
  });

  it("passes path + id through to the written record when given", () => {
    setUp();
    recordArtifactDelivery(
      cwd,
      "https://claude.ai/artifacts/abc",
      "Bug dashboard",
      "/beacon-home/ws/artifacts/abc.html",
      "abc",
    );
    const file = readWritten();
    expect(file.path).toBe("/beacon-home/ws/artifacts/abc.html");
    expect(file.id).toBe("abc");
    tearDown();
  });
});

describe("artifact history — ~/.beacon/<ws>/artifacts.json", () => {
  it("nextArtifactHistory — pure: prepends, newest-first", () => {
    const first = nextArtifactHistory([], { id: "a", url: "https://claude.ai/artifacts/a", ts: 100 });
    const second = nextArtifactHistory(first, { id: "b", url: "https://claude.ai/artifacts/b", ts: 200 });
    expect(second.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("nextArtifactHistory — pure: a re-publish of the same id MOVES it to the front, doesn't duplicate", () => {
    const list = [
      { id: "a", url: "https://claude.ai/artifacts/a", ts: 100 },
      { id: "b", url: "https://claude.ai/artifacts/b", ts: 200 },
    ];
    const next = nextArtifactHistory(list, { id: "a", url: "https://claude.ai/artifacts/a-v2", ts: 300 });
    expect(next.map((e) => e.id)).toEqual(["a", "b"]);
    expect(next.length).toBe(2);
    expect(next[0].url).toBe("https://claude.ai/artifacts/a-v2"); // the newer record for the same id wins
  });

  it("nextArtifactHistory — pure: caps at 50, dropping the oldest", () => {
    let list: ReturnType<typeof nextArtifactHistory> = [];
    for (let i = 0; i < 55; i++) {
      list = nextArtifactHistory(list, { id: `id-${i}`, url: `https://claude.ai/artifacts/${i}`, ts: i });
    }
    expect(list.length).toBe(50);
    expect(list[0].id).toBe("id-54"); // newest first
    expect(list.find((e) => e.id === "id-0")).toBeUndefined(); // oldest dropped
  });

  it("appendArtifactHistory — IO wrapper: persists to disk and reads back, newest first", () => {
    const ws = "ws-history-round-trip";
    appendArtifactHistory(ws, { id: "a", url: "https://claude.ai/artifacts/a", ts: 100, title: "First" });
    appendArtifactHistory(ws, { id: "b", url: "https://claude.ai/artifacts/b", ts: 200, path: "/x/b.html" });
    const history = readArtifactHistory(ws);
    expect(history.map((e) => e.id)).toEqual(["b", "a"]);
    expect(history[0].path).toBe("/x/b.html");
    const onDisk = JSON.parse(readFileSync(join(dataDirFor(ws), "artifacts.json"), "utf8"));
    expect(onDisk).toEqual(history);
  });

  it("appendArtifactHistory — a re-publish of the same id dedups instead of appending a duplicate", () => {
    const ws = "ws-history-dedup";
    appendArtifactHistory(ws, { id: "a", url: "https://claude.ai/artifacts/a", ts: 100 });
    appendArtifactHistory(ws, { id: "b", url: "https://claude.ai/artifacts/b", ts: 200 });
    appendArtifactHistory(ws, { id: "a", url: "https://claude.ai/artifacts/a-again", ts: 300 });
    const history = readArtifactHistory(ws);
    expect(history.length).toBe(2);
    expect(history.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("readArtifactHistory — tolerates a missing file (never written yet) → []", () => {
    expect(readArtifactHistory("ws-history-never-written")).toEqual([]);
  });

  it("readArtifactHistory — tolerates a garbage/corrupt file → []", () => {
    const ws = "ws-history-garbage";
    mkdirSync(dataDirFor(ws), { recursive: true });
    writeFileSync(join(dataDirFor(ws), "artifacts.json"), "{not json");
    expect(readArtifactHistory(ws)).toEqual([]);
  });

  it("readArtifactHistory — filters out malformed entries instead of throwing", () => {
    const ws = "ws-history-malformed-entries";
    mkdirSync(dataDirFor(ws), { recursive: true });
    writeFileSync(
      join(dataDirFor(ws), "artifacts.json"),
      JSON.stringify([{ id: "a", url: "https://claude.ai/artifacts/a", ts: 100 }, { url: "no-id" }, "garbage"]),
    );
    expect(readArtifactHistory(ws)).toEqual([{ id: "a", url: "https://claude.ai/artifacts/a", ts: 100 }]);
  });
});
