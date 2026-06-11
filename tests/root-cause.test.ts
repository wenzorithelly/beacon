import { describe, expect, it } from "bun:test";
import { rootCauseMessage } from "@/lib/root-cause";

// Agent-facing error surfacing: drizzle wraps the real failure in a DrizzleQueryError whose
// message is "Failed query: <sql> params: <every bound value>" — an agent reading that dump
// guessed "description too long" when the actual cause was SQLITE_BUSY. The root cause (with
// the driver's code) must surface instead.

describe("rootCauseMessage", () => {
  it("returns the deepest cause in the chain, prefixed with its code", () => {
    const libsql = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    const drizzle = new Error("Failed query: update Node set ... params: <10kb of description>", {
      cause: libsql,
    });
    expect(rootCauseMessage(drizzle)).toBe("SQLITE_BUSY: database is locked");
  });

  it("returns the message as-is when there is no cause chain", () => {
    expect(rootCauseMessage(new Error("plain failure"))).toBe("plain failure");
  });

  it("does not double the code when the message already contains it", () => {
    const e = Object.assign(new Error("SQLITE_FULL: disk full"), { code: "SQLITE_FULL" });
    expect(rootCauseMessage(e)).toBe("SQLITE_FULL: disk full");
  });

  it("stringifies non-Error values", () => {
    expect(rootCauseMessage("boom")).toBe("boom");
  });
});
