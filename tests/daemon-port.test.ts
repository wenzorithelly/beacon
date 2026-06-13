import { describe, expect, it } from "bun:test";
import { createServer, type Server } from "node:net";
import { findAvailablePort, isPortFree } from "@/lib/daemon-port";

function listen(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(port, "127.0.0.1", () => resolve(s));
  });
}
const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

// The resilience the `beacon` CLI relies on: a stray process on the preferred port must not
// wedge launch — we scan upward for a free one. Exercised against real loopback binds.
describe("isPortFree / findAvailablePort", () => {
  it("reports a bound port as not free and frees it on close", async () => {
    const port = await findAvailablePort(45000);
    expect(await isPortFree(port)).toBe(true);
    const srv = await listen(port);
    try {
      expect(await isPortFree(port)).toBe(false);
    } finally {
      await close(srv);
    }
    expect(await isPortFree(port)).toBe(true);
  });

  it("skips a taken port and returns the next free one", async () => {
    const taken = await findAvailablePort(45100);
    const srv = await listen(taken);
    try {
      const next = await findAvailablePort(taken);
      expect(next).toBeGreaterThan(taken);
      expect(await isPortFree(next)).toBe(true);
    } finally {
      await close(srv);
    }
  });

  it("returns the preferred port unchanged when it is free", async () => {
    const port = await findAvailablePort(45200);
    expect(await findAvailablePort(port)).toBe(port);
  });

  // Regression: the Beacon daemon (Next) binds IPv6 (`*`/`::`) on macOS, so a port held only on
  // the IPv6 loopback must read as taken — an IPv4-only probe used to call it free and would have
  // picked a port a running daemon already owned.
  it("treats a port held on the IPv6 loopback as taken (not only IPv4)", async () => {
    const port = await findAvailablePort(45300);
    let srv: Server;
    try {
      srv = await new Promise<Server>((resolve, reject) => {
        const s = createServer();
        s.once("error", reject);
        s.listen(port, "::1", () => resolve(s));
      });
    } catch {
      return; // host has no IPv6 loopback — nothing to assert
    }
    try {
      expect(await isPortFree(port)).toBe(false);
    } finally {
      await close(srv);
    }
  });
});
