import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL_SH = join(ROOT, "public", "install.sh");

// A stub `bun` that satisfies everything install.sh asks of it WITHOUT touching the network:
//   bun pm bin -g  → prints its own dir (the global bin, i.e. $HOME/.bun/bin)
//   bun add -g …   → no-op success
const BUN_STUB = `#!/bin/sh
if [ "$1" = "pm" ] && [ "$2" = "bin" ]; then
  cd "$(dirname "$0")" && pwd
  exit 0
fi
exit 0
`;

// Run public/install.sh with a controlled HOME + PATH and no real bun reachable, so we exercise
// the "bun lives at its default location but this shell's PATH doesn't have it yet" branch — the
// exact situation a fresh `curl … | sh` leaves a user in.
function runInstaller({ bunBinOnPath }: { bunBinOnPath: boolean }) {
  const home = mkdtempSync(join(tmpdir(), "beacon-install-"));
  try {
    const bunBin = join(home, ".bun", "bin");
    mkdirSync(bunBin, { recursive: true });
    writeFileSync(join(bunBin, "bun"), BUN_STUB);
    chmodSync(join(bunBin, "bun"), 0o755);
    writeFileSync(join(home, ".zshrc"), "# existing rc\n");

    // System dirs give us sh/printf/grep/etc. but no bun. Optionally prepend bun's bin.
    const sys = "/usr/bin:/bin:/usr/sbin:/sbin";
    const PATH = bunBinOnPath ? `${bunBin}:${sys}` : sys;
    const r = spawnSync("sh", [INSTALL_SH], {
      env: { HOME: home, PATH, SHELL: "/bin/zsh", BUN_INSTALL: join(home, ".bun") },
      encoding: "utf8",
      timeout: 60_000,
    });
    return { ...r, bunBin };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("public/install.sh PATH guidance", () => {
  it("tells the user how to reload their shell when bun's bin isn't on the current PATH", () => {
    const r = runInstaller({ bunBinOnPath: false });
    expect(r.status).toBe(0);
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toContain("Beacon installed");
    // It must point at the bin that's missing from PATH and how to pick it up — otherwise the
    // user just sees "✓ installed" and then `beacon: command not found`.
    expect(out).toContain(r.bunBin);
    expect(out).toMatch(/source|new terminal|restart/i);
  });

  it("does not nag about PATH when bun's bin is already on it", () => {
    const r = runInstaller({ bunBinOnPath: true });
    expect(r.status).toBe(0);
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toContain("Beacon installed");
    expect(out).not.toMatch(/source|new terminal|restart/i);
  });
});
