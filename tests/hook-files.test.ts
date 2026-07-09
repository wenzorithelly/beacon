import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { filesFromToolEvent } from "@/lib/hook-files";

const CWD = "/tmp/repo";

describe("filesFromToolEvent — Claude shapes", () => {
  it("reads file_path / path / files[].file_path", () => {
    expect(
      filesFromToolEvent({ tool_input: { file_path: "/abs/a.ts" }, cwd: CWD }),
    ).toEqual(["/abs/a.ts"]);
    expect(filesFromToolEvent({ tool_input: { path: "/abs/b.ts" }, cwd: CWD })).toEqual([
      "/abs/b.ts",
    ]);
    expect(
      filesFromToolEvent({
        tool_input: { files: [{ file_path: "/abs/c.ts" }, { file_path: "/abs/d.ts" }] },
        cwd: CWD,
      }),
    ).toEqual(["/abs/c.ts", "/abs/d.ts"]);
  });

  it("returns [] for non-edit tool input and garbage", () => {
    expect(filesFromToolEvent({ tool_input: { command: "ls -la" }, cwd: CWD })).toEqual([]);
    expect(filesFromToolEvent({})).toEqual([]);
    expect(filesFromToolEvent({ tool_input: null })).toEqual([]);
    expect(filesFromToolEvent({ tool_input: 42 })).toEqual([]);
  });
});

const PATCH = `*** Begin Patch
*** Update File: lib/a.ts
@@ -1,2 +1,2 @@
-old
+new
*** Add File: lib/new.ts
+export const x = 1;
*** Delete File: lib/gone.ts
*** End Patch`;

describe("filesFromToolEvent — Codex apply_patch", () => {
  it("extracts Update/Add paths (cwd-resolved), skipping Delete", () => {
    // The patch-text field name varies — any string value carrying the envelope counts.
    const out = filesFromToolEvent({
      tool_name: "apply_patch",
      tool_input: { input: PATCH },
      cwd: CWD,
    });
    expect(out).toEqual([resolve(CWD, "lib/a.ts"), resolve(CWD, "lib/new.ts")]);
  });

  it("finds the patch in a differently-named field", () => {
    const out = filesFromToolEvent({ tool_input: { patch: PATCH }, cwd: CWD });
    expect(out).toEqual([resolve(CWD, "lib/a.ts"), resolve(CWD, "lib/new.ts")]);
  });

  it("a rename (Move to) reports the new path, not the old one", () => {
    const patch = `*** Begin Patch
*** Update File: lib/old-name.ts
*** Move to: lib/new-name.ts
@@ -1 +1 @@
-x
+y
*** End Patch`;
    const out = filesFromToolEvent({ tool_input: { input: patch }, cwd: CWD });
    expect(out).toEqual([resolve(CWD, "lib/new-name.ts")]);
  });

  it("falls back to process.cwd() when the event has no cwd", () => {
    const out = filesFromToolEvent({ tool_input: { input: PATCH } });
    expect(out[0]).toBe(resolve(process.cwd(), "lib/a.ts"));
  });

  it("ignores strings that merely mention apply_patch syntax without the envelope", () => {
    const out = filesFromToolEvent({
      tool_input: { command: "echo '*** Update File: x.ts'" },
      cwd: CWD,
    });
    expect(out).toEqual([]);
  });

  it("explicit file fields win over patch scanning", () => {
    const out = filesFromToolEvent({
      tool_input: { file_path: "/abs/a.ts", input: PATCH },
      cwd: CWD,
    });
    expect(out).toEqual(["/abs/a.ts"]);
  });
});

describe("bin/hook.ts end-to-end (subprocess)", () => {
  it("a Codex apply_patch event POSTs resolved files with the workspace header", async () => {
    const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const home = mkdtempSync(join(tmpdir(), "beacon-hook-codex-"));
    const repo = mkdtempSync(join(tmpdir(), "beacon-hook-repo-"));
    let resolveReq: (v: { url: string; ws: string | null; body: { files: string[] } }) => void;
    const got = new Promise<{ url: string; ws: string | null; body: { files: string[] } }>(
      (r) => (resolveReq = r),
    );
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        resolveReq({
          url: new URL(req.url).pathname,
          ws: req.headers.get("x-beacon-workspace"),
          body: (await req.json()) as { files: string[] },
        });
        return Response.json({ ok: true });
      },
    });
    try {
      const event = JSON.stringify({
        tool_name: "apply_patch",
        tool_input: { input: PATCH },
        cwd: repo,
      });
      // Async spawn — spawnSync would block this event loop and deadlock Bun.serve.
      const proc = Bun.spawn(["bun", "bin/hook.ts"], {
        cwd: PKG_DIR,
        env: {
          ...process.env,
          HOME: home,
          BEACON_CODEX: "0",
          BEACON_URL: `http://127.0.0.1:${server.port}`,
        },
        stdin: new TextEncoder().encode(event),
        stdout: "ignore",
        stderr: "ignore",
      });
      expect(await proc.exited).toBe(0);
      const req = await got;
      expect(req.url).toBe("/api/map/touch-active");
      expect(typeof req.ws).toBe("string");
      expect(req.body.files).toEqual([resolve(repo, "lib/a.ts"), resolve(repo, "lib/new.ts")]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("times out delivery when the Beacon daemon does not respond", async () => {
    const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const home = mkdtempSync(join(tmpdir(), "beacon-hook-timeout-"));
    const repo = mkdtempSync(join(tmpdir(), "beacon-hook-timeout-repo-"));
    const server = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
    const proc = Bun.spawn(["bun", "bin/hook.ts"], {
      cwd: PKG_DIR,
      env: {
        ...process.env,
        HOME: home,
        BEACON_CODEX: "0",
        BEACON_URL: `http://127.0.0.1:${server.port}`,
      },
      stdin: new TextEncoder().encode(JSON.stringify({ tool_name: "apply_patch", tool_input: { input: PATCH }, cwd: repo })),
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      const finished = await Promise.race([proc.exited.then(() => true), Bun.sleep(4_000).then(() => false)]);
      expect(finished).toBe(true);
      expect(await proc.exited).toBe(0);
    } finally {
      proc.kill();
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
