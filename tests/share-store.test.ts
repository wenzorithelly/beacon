import { describe, expect, it } from "bun:test";
import {
  parseShareSnapshot,
  insertSharedBoard,
  interpretSharedRow,
  expiresAtFrom,
  MAX_SNAPSHOT_BYTES,
  SHARE_TTL_MS,
} from "@/lib/share-store";
import { SHARE_SNAPSHOT_VERSION, type ShareSnapshot } from "@/lib/share-snapshot";

function snap(): ShareSnapshot {
  return {
    kind: "boards",
    version: SHARE_SNAPSHOT_VERSION,
    createdAt: 1,
    workspaceLabel: "beacon",
    selectedTabs: ["ROADMAP", "DATABASE"],
  };
}

describe("parseShareSnapshot", () => {
  it("accepts a valid snapshot", () => {
    expect(parseShareSnapshot(JSON.stringify(snap())).ok).toBe(true);
  });

  it("413s a payload over the byte cap (before parsing)", () => {
    expect(parseShareSnapshot("x".repeat(MAX_SNAPSHOT_BYTES + 1))).toMatchObject({
      ok: false,
      status: 413,
    });
  });

  it("400s invalid JSON", () => {
    expect(parseShareSnapshot("{not json")).toMatchObject({ ok: false, status: 400 });
  });

  it("400s a structurally-wrong or wrong-version snapshot", () => {
    expect(parseShareSnapshot(JSON.stringify({}))).toMatchObject({ ok: false, status: 400 });
    expect(parseShareSnapshot(JSON.stringify({ ...snap(), version: 999 }))).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});

describe("insertSharedBoard", () => {
  it("writes the row a deploy expects (token, summary, json payload, expiry)", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const fakeDb = {
      insert: () => ({ values: async (row: Record<string, unknown>) => void captured.push(row) }),
    } as never;
    const { token } = await insertSharedBoard(snap(), { dbInstance: fakeDb, token: "tok", now: 0 });
    expect(token).toBe("tok");
    expect(captured[0]).toMatchObject({
      token: "tok",
      selectedTabs: "ROADMAP,DATABASE",
      payload: JSON.stringify(snap()),
      version: SHARE_SNAPSHOT_VERSION,
    });
    expect((captured[0].expiresAt as Date).getTime()).toBe(SHARE_TTL_MS);
  });
});

describe("expiresAtFrom", () => {
  it("is now + 7 days", () => {
    expect(expiresAtFrom(1000).getTime()).toBe(1000 + SHARE_TTL_MS);
  });
});

describe("interpretSharedRow", () => {
  it("flags expiry by the stored timestamp and parses the payload", () => {
    const row = { payload: JSON.stringify(snap()), expiresAt: new Date(1000) };
    expect(interpretSharedRow(row, 500)!.expired).toBe(false);
    expect(interpretSharedRow(row, 2000)!.expired).toBe(true);
    const got = interpretSharedRow(row, 500)!.snapshot;
    expect(got.kind).toBe("boards");
  });

  it("returns null for an unparseable payload", () => {
    expect(interpretSharedRow({ payload: "nope", expiresAt: null }, 0)).toBeNull();
  });

  it("never expires a row with a null expiresAt", () => {
    expect(interpretSharedRow({ payload: JSON.stringify(snap()), expiresAt: null }, 9e15)!.expired).toBe(false);
  });
});
