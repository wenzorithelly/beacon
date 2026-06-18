import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INIT_SKILL } from "@/lib/assets";
import { idForPath } from "@/lib/workspaces";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The /beacon-init skill is installed GLOBALLY (~/.claude/skills), so it runs in any repo —
// including one never opened with `beacon`, where .mcp.json is absent and the beacon_init_persist
// MCP tool therefore isn't in the session. The skill must NOT dead-end by telling the user to run
// `beacon` and start over; it must self-bootstrap via the `beacon init-persist` CLI, which wires
// the repo + persists the analysis directly to /api/init so init completes in the SAME session.
describe("/beacon-init self-bootstrap when the repo isn't wired", () => {
  it("the skill points at `beacon init-persist` as the fallback, not a dead-end", () => {
    expect(INIT_SKILL).toContain("beacon init-persist");
    // The old behavior — "tell the user to run `beacon` here first, then re-invoke" — was the bug.
    expect(INIT_SKILL).not.toMatch(/run\s+`beacon`\s+here first/i);
  });

  it("`beacon init-persist` is dispatched and fails fast (exit 1) when the analysis is unreadable", () => {
    // The payload is read BEFORE any wiring/daemon, so an unreadable path exits cleanly with no
    // side effects — which also proves the subcommand is actually wired into dispatch (a fall-through
    // to launchPanel would instead try to register the workspace + spawn the daemon).
    const r = spawnSync("bun", [join(ROOT, "bin", "beacon.ts"), "init-persist", "/no/such/analysis.json"], {
      cwd: ROOT,
      env: { ...process.env, BEACON_NO_OPEN: "1" },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("could not read the init analysis");
    // It must NOT have fallen through to launching the panel.
    expect(`${r.stdout}${r.stderr}`).not.toContain("◉ Beacon\n");
  });

  // The happy path: against a mock daemon, `beacon init-persist <file>` must POST the analysis to
  // /api/init with the SAME workspace-pinning headers the MCP server sends, then report the counts.
  // Fully isolated — HOME + BEACON_HOME point at a throwaway dir, and the daemon is a Bun.serve
  // mock — so nothing touches the user's real ~/.claude, ~/.beacon, or the live Beacon map.
  it("POSTs the analysis to /api/init with workspace headers and echoes the counts", async () => {
    const home = mkdtempSync(join(tmpdir(), "beacon-init-persist-"));
    const repo = join(home, "proj"); // a SUBDIR of HOME → registrable (≠ home dir itself)
    mkdirSync(repo, { recursive: true });
    mkdirSync(join(home, ".beacon"), { recursive: true });

    const analysis = {
      overview: "A throwaway project for the init-persist integration test.",
      conventions: ["bun for everything"],
      hasFrontend: false,
      components: [
        { title: "API", domain: "API", files: ["server.ts"] },
        { title: "DATA", domain: "DATA", files: ["db.ts"] },
      ],
      roadmap: [{ title: "Add tests", why: "no coverage yet", category: "QUALITY", priority: 2 }],
    };
    writeFileSync(join(home, "analysis.json"), JSON.stringify(analysis));

    let captured: { path: string; method: string; headers: Record<string, string>; body: string } | null = null;
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/workspace") return new Response("{}"); // ensureDaemon's liveness probe
        if (url.pathname === "/api/init") {
          captured = {
            path: url.pathname,
            method: req.method,
            headers: Object.fromEntries(req.headers),
            body: await req.text(),
          };
          return Response.json({ ok: true, components: 2, roadmap: 1, deduped: 0, tables: 0, endpoints: 0, context: [] });
        }
        return new Response("not found", { status: 404 });
      },
    });
    // Point the CLI's ensureDaemon at our mock: a live pid (this process) + the mock's port.
    writeFileSync(join(home, ".beacon", "server.json"), JSON.stringify({ pid: process.pid, port: server.port }));

    try {
      const proc = Bun.spawn({
        cmd: ["bun", join(ROOT, "bin", "beacon.ts"), "init-persist", join(home, "analysis.json")],
        cwd: repo,
        env: { ...process.env, HOME: home, BEACON_HOME: join(home, ".beacon"), BEACON_NO_OPEN: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);

      expect(exitCode).toBe(0);
      expect(captured).not.toBeNull();
      const cap = captured!;
      expect(cap.method).toBe("POST");
      // The path header pins the workspace; the id header must be its hash — exactly what /api/init
      // uses to register + provision the right repo (never the browser's active one).
      const sentPath = cap.headers["x-beacon-workspace-path"];
      expect(sentPath).toBeTruthy();
      expect(cap.headers["x-beacon-workspace"]).toBe(idForPath(sentPath));
      expect(JSON.parse(cap.body)).toEqual(analysis);
      // The CLI echoes the daemon's response so the agent can read + report the counts.
      expect(stdout).toContain('"components":2');
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);
});
