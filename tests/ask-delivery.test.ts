import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-ask-delivery-"));

import { nextAskDelivery, readAskDelivery, writeAskDelivery } from "@/lib/ask-delivery";

// The delivery queue is the other half of the two-way ask bridge: Beacon hands a clicked option to
// whatever registered deliverer (lib/deliverer-registry) can type it into the terminal. Same
// monotonic-seq shape as lib/nav-intent so a consumer that's already seen seq N never re-acts on it.

describe("nextAskDelivery", () => {
  it("starts at seq 1 for the first delivery (no prior)", () => {
    expect(nextAskDelivery(null, "ask-1", ["Yes"], 100)).toEqual({
      seq: 1,
      askId: "ask-1",
      selected: ["Yes"],
      ts: 100,
    });
  });

  it("increments seq monotonically across deliveries", () => {
    const first = nextAskDelivery(null, "ask-1", ["Yes"], 100);
    const second = nextAskDelivery(first, "ask-2", ["No"], 200);
    expect(second).toEqual({ seq: 2, askId: "ask-2", selected: ["No"], ts: 200 });
  });
});

describe("read/write round trip", () => {
  it("persists a delivery to disk and reads it back", () => {
    const rec = writeAskDelivery("ask-abc", ["Postgres"], 1000);
    expect(rec.seq).toBe(1);
    expect(readAskDelivery()).toEqual(rec);
  });

  it("bumps seq on a second write instead of resetting it (continues from the prior test)", () => {
    const second = writeAskDelivery("ask-def", ["SQLite"], 2000);
    expect(second.seq).toBe(2);
    expect(readAskDelivery()).toEqual(second);
  });
});
