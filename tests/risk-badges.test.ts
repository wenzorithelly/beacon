import { describe, expect, it } from "bun:test";
import { tableRiskBadges, endpointRiskBadges } from "@/lib/risk-badges";

describe("tableRiskBadges", () => {
  it("flags credential-like columns as danger", () => {
    const b = tableRiskBadges({ domain: null, columns: [{ name: "id" }, { name: "password_hash" }] });
    const secrets = b.find((x) => x.label === "secrets");
    expect(secrets).toBeTruthy();
    expect(secrets!.tone).toBe("danger");
  });

  it("flags the auth domain", () => {
    expect(tableRiskBadges({ domain: "auth", columns: [{ name: "id" }] }).map((b) => b.label)).toContain("auth");
  });

  it("emits no badges for a benign table", () => {
    expect(tableRiskBadges({ domain: "blog", columns: [{ name: "title" }, { name: "body" }] })).toEqual([]);
  });
});

describe("endpointRiskBadges", () => {
  it("flags DELETE as destructive (danger)", () => {
    const b = endpointRiskBadges({ method: "DELETE", domain: null, path: "/posts/{id}" });
    const del = b.find((x) => x.label === "DELETE");
    expect(del).toBeTruthy();
    expect(del!.tone).toBe("danger");
  });

  it("flags auth-related endpoints by path OR domain", () => {
    expect(endpointRiskBadges({ method: "POST", domain: null, path: "/auth/login" }).map((b) => b.label)).toContain("auth");
    expect(endpointRiskBadges({ method: "GET", domain: "auth", path: "/me" }).map((b) => b.label)).toContain("auth");
  });

  it("emits no badges for a benign GET", () => {
    expect(endpointRiskBadges({ method: "GET", domain: "blog", path: "/posts" })).toEqual([]);
  });
});
