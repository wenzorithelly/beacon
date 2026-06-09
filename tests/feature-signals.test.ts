import { describe, expect, it } from "bun:test";
import { featureSignals } from "@/lib/feature-signals";

describe("featureSignals", () => {
  it("counts attached files that are in the untested set", () => {
    const untested = new Set(["lib/a.ts", "lib/c.ts"]);
    const s = featureSignals(["lib/a.ts", "lib/b.ts", "lib/c.ts"], untested);
    expect(s.untested).toBe(2);
    expect(s.total).toBe(3);
  });

  it("flags auth when any attached file path is auth-sensitive", () => {
    expect(featureSignals(["app/auth/login.ts"], new Set()).auth).toBe(true);
    expect(featureSignals(["lib/password-reset.ts"], new Set()).auth).toBe(true);
    expect(featureSignals(["components/session-list.tsx"], new Set()).auth).toBe(true);
    expect(featureSignals(["lib/db.ts"], new Set()).auth).toBe(false);
  });

  it("does not over-match common words", () => {
    expect(featureSignals(["lib/tokenizer.ts"], new Set()).auth).toBe(false);
    expect(featureSignals(["lib/options.ts"], new Set()).auth).toBe(false);
  });

  it("returns zeroed signals for a feature with no files", () => {
    expect(featureSignals([], new Set(["lib/a.ts"]))).toEqual({ untested: 0, total: 0, auth: false });
  });
});
