import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandExists, nodeWhich, parseTomlBeacon } from "@/lib/codex-install";

// Deliverable A — the Node fallbacks that make the compiled CLI bundle runtime-agnostic. `bun test`
// can't simulate a no-Bun runtime, so we exercise the EXTRACTED PURE fallbacks directly (the private
// repo's `make cli-check` is the real end-to-end proof under Electron-as-Node).

describe("nodeWhich (Bun.which fallback)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "beacon-which-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("finds an executable on the given PATH via the real X_OK predicate", () => {
    const bin = join(dir, "codex");
    writeFileSync(bin, "#!/bin/sh\necho hi\n");
    chmodSync(bin, 0o755);
    expect(nodeWhich("codex", dir)).toBe(bin);
  });

  it("returns null for a non-executable file (X_OK fails)", () => {
    const bin = join(dir, "codex");
    writeFileSync(bin, "not executable");
    chmodSync(bin, 0o644);
    expect(nodeWhich("codex", dir)).toBeNull();
  });

  it("returns null when the binary isn't on PATH, and scans multiple dirs", () => {
    const other = mkdtempSync(join(tmpdir(), "beacon-which2-"));
    const bin = join(other, "codex");
    writeFileSync(bin, "#!/bin/sh\n");
    chmodSync(bin, 0o755);
    expect(nodeWhich("codex", `${dir}${":"}${other}`)).toBe(bin); // found in the 2nd PATH entry
    expect(nodeWhich("codex", dir)).toBeNull(); // absent from the 1st alone
    rmSync(other, { recursive: true, force: true });
  });

  it("is pure/injectable — a fake predicate drives the result without touching disk", () => {
    expect(nodeWhich("codex", "/a:/b", (p) => p === join("/b", "codex"))).toBe(join("/b", "codex"));
    expect(nodeWhich("codex", "/a:/b", () => false)).toBeNull();
    expect(nodeWhich("", "/a:/b", () => true)).toBeNull(); // empty name → null
  });
});

describe("commandExists", () => {
  it("resolves a real shell binary and rejects a bogus one", () => {
    expect(commandExists("sh")).toBe(true);
    expect(commandExists("beacon-not-a-real-binary-xyz")).toBe(false);
  });
});

describe("parseTomlBeacon (Bun.TOML fallback — targeted, two keys)", () => {
  it("reads the [mcp_servers.beacon] command Beacon writes", () => {
    const c = parseTomlBeacon(`[mcp_servers.beacon]\ncommand = "beacon"\nargs = ["mcp"]\n`);
    expect(c.mcp_servers?.beacon?.command).toBe("beacon");
  });

  it("reads an app-shim absolute path as the command", () => {
    const path = "/Applications/Beacon.app/Contents/Resources/bin/beacon";
    const c = parseTomlBeacon(`[mcp_servers.beacon]\ncommand = "${path}"\nargs = ["mcp"]\n`);
    expect(c.mcp_servers?.beacon?.command).toBe(path);
  });

  it("ignores user content + comments and stops at the next table header", () => {
    const c = parseTomlBeacon(
      `# a comment\nmodel = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n\n[mcp_servers.beacon]\ncommand = "beacon"\n\n[model_providers.z]\ncommand = "should-not-leak"\n`,
    );
    expect(c.mcp_servers?.beacon?.command).toBe("beacon");
  });

  it("returns no beacon entry when the table is absent", () => {
    const c = parseTomlBeacon(`model = "gpt-5"\n[mcp_servers.other]\ncommand = "x"\n`);
    expect(c.mcp_servers?.beacon).toBeUndefined();
  });
});
