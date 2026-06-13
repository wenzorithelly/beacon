import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beaconHome } from "@/lib/workspaces";
import { daemonBaseUrl, readServerInfo } from "@/lib/daemon-server";

// BEACON_HOME is a throwaway temp dir under test (tests/bun-setup.ts), so writing server.json
// here never touches the real ~/.beacon. We do restore BEACON_URL/PORT since they're global.
const serverFile = () => join(beaconHome(), "server.json");
const savedUrl = process.env.BEACON_URL;
const savedPort = process.env.PORT;

afterEach(() => {
  if (savedUrl === undefined) delete process.env.BEACON_URL;
  else process.env.BEACON_URL = savedUrl;
  if (savedPort === undefined) delete process.env.PORT;
  else process.env.PORT = savedPort;
  rmSync(serverFile(), { force: true });
});

describe("daemonBaseUrl", () => {
  it("honors an explicit BEACON_URL above everything", () => {
    process.env.BEACON_URL = "http://example.test:9999";
    mkdirSync(beaconHome(), { recursive: true });
    writeFileSync(serverFile(), JSON.stringify({ pid: 1, port: 4321 }));
    expect(daemonBaseUrl()).toBe("http://example.test:9999");
  });

  it("uses the port the daemon recorded in server.json (not the 4319 default)", () => {
    delete process.env.BEACON_URL;
    delete process.env.PORT;
    mkdirSync(beaconHome(), { recursive: true });
    writeFileSync(serverFile(), JSON.stringify({ pid: 1, port: 4321 }));
    expect(readServerInfo()?.port).toBe(4321);
    expect(daemonBaseUrl()).toBe("http://localhost:4321");
  });

  it("falls back to the default port when there is no server.json", () => {
    delete process.env.BEACON_URL;
    delete process.env.PORT;
    rmSync(serverFile(), { force: true });
    expect(readServerInfo()).toBeNull();
    expect(daemonBaseUrl()).toBe("http://localhost:4319");
  });
});
