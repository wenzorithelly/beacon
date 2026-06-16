import { describe, expect, it } from "bun:test";
import { publicPathAllowed } from "@/proxy";

// On the public deploy (PUBLIC mode) only an allowlist is served; everything else redirects to /.
// The shareable-link feature adds the read-only board view (/s/*) and the snapshot ingest
// (/api/share, EXACT) — but must NOT expose the local-only mint route (/api/share/create) or any
// of the tool's repo-data routes.
describe("publicPathAllowed", () => {
  it("admits the shared board view and the snapshot ingest", () => {
    expect(publicPathAllowed("/s/abc123")).toBe(true);
    expect(publicPathAllowed("/api/share")).toBe(true);
  });

  it("keeps admitting the pre-existing public surfaces", () => {
    for (const p of ["/", "/docs", "/install.sh", "/api/feedback", "/api/telemetry"])
      expect(publicPathAllowed(p)).toBe(true);
  });

  it("does NOT expose the local-only mint route or the tool's repo-data routes", () => {
    for (const p of ["/api/share/create", "/map", "/plan", "/api/nodes", "/api/entities", "/settings"])
      expect(publicPathAllowed(p)).toBe(false);
  });
});
