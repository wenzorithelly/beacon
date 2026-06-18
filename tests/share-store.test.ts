import { describe, expect, it } from "bun:test";
import {
  parseShareSnapshot,
  insertSharedBoard,
  interpretSharedRow,
  isAuthorizedShareRequest,
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

// Stub of the Drizzle upsert chain: db.insert(t).values(row).onConflictDoUpdate(cfg).
// Captures the inserted row and any conflict config so tests can assert both.
function captureDb(
  rows: Array<Record<string, unknown>>,
  conflicts: Array<Record<string, unknown>> = [],
) {
  return {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        rows.push(row);
        return { onConflictDoUpdate: async (cfg: Record<string, unknown>) => void conflicts.push(cfg) };
      },
    }),
  } as never;
}

describe("insertSharedBoard", () => {
  it("writes the row a deploy expects (token, summary, json payload, 7-day expiry)", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const { token } = await insertSharedBoard(snap(), { dbInstance: captureDb(rows), token: "tok", now: 0 });
    expect(token).toBe("tok");
    expect(rows[0]).toMatchObject({
      token: "tok",
      selectedTabs: "ROADMAP,DATABASE",
      payload: JSON.stringify(snap()),
      version: SHARE_SNAPSHOT_VERSION,
    });
    expect((rows[0].expiresAt as Date).getTime()).toBe(SHARE_TTL_MS);
  });

  it("writes a null expiry for a permanent board", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const { expiresAt } = await insertSharedBoard(snap(), {
      dbInstance: captureDb(rows),
      token: "beacon",
      permanent: true,
      now: 0,
    });
    expect(rows[0].expiresAt).toBeNull();
    expect(expiresAt).toBeNull();
  });

  it("upserts on the token so a pinned refresh overwrites in place", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const conflicts: Array<Record<string, unknown>> = [];
    await insertSharedBoard(snap(), { dbInstance: captureDb(rows, conflicts), token: "beacon", permanent: true });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toHaveProperty("set");
    expect((conflicts[0].set as Record<string, unknown>).payload).toBe(JSON.stringify(snap()));
    expect((conflicts[0].set as Record<string, unknown>).expiresAt).toBeNull();
  });
});

describe("isAuthorizedShareRequest", () => {
  it("rejects when no admin token is configured (unset = locked)", () => {
    expect(isAuthorizedShareRequest("Bearer x", undefined)).toBe(false);
    expect(isAuthorizedShareRequest("Bearer x", "")).toBe(false);
  });

  it("rejects a wrong or malformed authorization header", () => {
    expect(isAuthorizedShareRequest("Bearer nope", "secret")).toBe(false);
    expect(isAuthorizedShareRequest("secret", "secret")).toBe(false); // missing Bearer prefix
    expect(isAuthorizedShareRequest(null, "secret")).toBe(false);
  });

  it("accepts the exact Bearer admin token", () => {
    expect(isAuthorizedShareRequest("Bearer secret", "secret")).toBe(true);
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
