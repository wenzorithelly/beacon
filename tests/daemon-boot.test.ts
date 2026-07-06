import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideDaemonBoot, decideDaemonRecheck, desktopAppInstalled } from "@/lib/daemon-boot";

// Deliverable C — the headless app-boot decision, unit-tested pure (app-installed × daemon-healthy
// matrix) so the branch's logic is proven without launching the real app or stopping the real daemon.
// The end-to-end `open -ga Beacon` boot is verified manually against the packaged app (see the private
// repo's README acceptance trace); it is intentionally NOT exercised here.

describe("decideDaemonBoot", () => {
  it("healthy daemon → reuse, regardless of the app", () => {
    expect(decideDaemonBoot({ healthy: true, appInstalled: true })).toBe("reuse");
    expect(decideDaemonBoot({ healthy: true, appInstalled: false })).toBe("reuse");
  });

  it("no daemon + app installed → launch the app headlessly", () => {
    expect(decideDaemonBoot({ healthy: false, appInstalled: true })).toBe("app");
  });

  it("no daemon + no app → spawn the bundled server with bun", () => {
    expect(decideDaemonBoot({ healthy: false, appInstalled: false })).toBe("bun");
  });
});

describe("decideDaemonRecheck", () => {
  // The last-moment recheck run right before the bun daemon would spawn, after bootViaApp timed out.
  // Guards the double-boot race: a slow app that goes healthy just after the ~30s poll must be reused,
  // not clobbered by a second daemon writing server.json against the same BEACON_HOME.
  it("recheck finds a live, healthy backend → reuse (don't spawn a second daemon)", () => {
    expect(decideDaemonRecheck({ present: true, alive: true, healthy: true })).toBe("reuse");
  });

  it("recheck finds nothing / a dead / an unhealthy pid → spawn", () => {
    expect(decideDaemonRecheck({ present: false, alive: false, healthy: false })).toBe("spawn"); // no server.json
    expect(decideDaemonRecheck({ present: true, alive: false, healthy: false })).toBe("spawn"); // stale pid, dead
    expect(decideDaemonRecheck({ present: true, alive: false, healthy: true })).toBe("spawn"); // healthy port, dead pid (someone else)
    expect(decideDaemonRecheck({ present: true, alive: true, healthy: false })).toBe("spawn"); // alive but not answering
  });
});

describe("desktopAppInstalled", () => {
  it("true when the embedded shim exists, false otherwise (injectable path)", () => {
    const dir = mkdtempSync(join(tmpdir(), "beacon-app-probe-"));
    const shim = join(dir, "beacon");
    writeFileSync(shim, "#!/bin/sh\n");
    expect(desktopAppInstalled(shim)).toBe(true);
    expect(desktopAppInstalled(join(dir, "nope"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
