import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideDaemonBoot, desktopAppInstalled } from "@/lib/daemon-boot";

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
