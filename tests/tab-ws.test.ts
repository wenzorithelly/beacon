import { describe, expect, it } from "bun:test";
import { resolveTabWs, buildTabHref, isApiRequest } from "@/lib/tab-ws";

// Per-tab workspace resolution: the ?ws URL param wins (a fresh pin), then the sticky
// sessionStorage value (survives a bare in-tab navigation), then null (cookie/active fallback).
describe("resolveTabWs", () => {
  it("prefers the URL param over stored", () => {
    expect(resolveTabWs("a", "b")).toBe("a");
  });
  it("falls back to the stored value when no param", () => {
    expect(resolveTabWs(null, "b")).toBe("b");
    expect(resolveTabWs("", "b")).toBe("b");
  });
  it("is null when neither is present", () => {
    expect(resolveTabWs(null, null)).toBeNull();
    expect(resolveTabWs("", "")).toBeNull();
  });
});

describe("buildTabHref", () => {
  it("appends ?ws when present", () => {
    expect(buildTabHref("/map", "abc")).toBe("/map?ws=abc");
  });
  it("preserves extra params alongside ws", () => {
    expect(buildTabHref("/map", "abc", { view: "DATABASE" })).toBe("/map?ws=abc&view=DATABASE");
  });
  it("is a bare path when ws is null", () => {
    expect(buildTabHref("/settings", null)).toBe("/settings");
  });
  it("still adds extra params with no ws", () => {
    expect(buildTabHref("/map", null, { view: "FILES" })).toBe("/map?view=FILES");
  });
});

// The fetch interceptor only pins same-origin /api/* requests (so RSC navigations to page paths
// and cross-origin calls are untouched, and /plan's explicit headers still win).
describe("isApiRequest", () => {
  const origin = "http://localhost:4319";
  it("matches relative /api paths", () => {
    expect(isApiRequest("/api/nodes", origin)).toBe(true);
    expect(isApiRequest("/api/board-annotations/x", origin)).toBe(true);
  });
  it("matches same-origin absolute /api URLs", () => {
    expect(isApiRequest("http://localhost:4319/api/db/tables/1", origin)).toBe(true);
  });
  it("ignores non-/api paths (RSC navigations, pages)", () => {
    expect(isApiRequest("/map?ws=a", origin)).toBe(false);
    expect(isApiRequest("/plan", origin)).toBe(false);
    expect(isApiRequest("/apixyz", origin)).toBe(false);
  });
  it("ignores cross-origin requests", () => {
    expect(isApiRequest("https://evil.example.com/api/x", origin)).toBe(false);
  });
});
