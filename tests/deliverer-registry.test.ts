import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-deliverer-"));

import {
  DELIVERER_PRESENCE_TTL_MS,
  isDelivererLive,
  recordDelivererPresence,
} from "@/lib/deliverer-registry";

// A live deliverer is what flips an ask's option buttons from a read-only hint to clickable
// (components/ask/ask-modal.tsx) — a stale one MUST stop advertising automatically (the client that
// registered it crashed, closed, or the workspace lost its agent session), never leave a
// clickable-looking UI with nothing on the other end to type the answer.

describe("deliverer presence", () => {
  it("is not live before anything ever heartbeats", () => {
    expect(isDelivererLive(Date.now())).toBe(false);
  });

  it("is live immediately after a heartbeat", () => {
    recordDelivererPresence(1_000_000);
    expect(isDelivererLive(1_000_000)).toBe(true);
    expect(isDelivererLive(1_000_000 + DELIVERER_PRESENCE_TTL_MS - 1)).toBe(true);
  });

  it("goes stale once the TTL has elapsed since the last heartbeat", () => {
    recordDelivererPresence(2_000_000);
    expect(isDelivererLive(2_000_000 + DELIVERER_PRESENCE_TTL_MS)).toBe(false);
  });

  it("a fresh heartbeat revives a stale deliverer", () => {
    recordDelivererPresence(2_000_000);
    expect(isDelivererLive(2_000_000 + DELIVERER_PRESENCE_TTL_MS)).toBe(false);
    recordDelivererPresence(3_000_000);
    expect(isDelivererLive(3_000_000)).toBe(true);
  });
});
