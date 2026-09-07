import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { idForPath } from "@/lib/workspaces";

// bin/orient.ts end-to-end (subprocess) — same pattern as tests/hook-files.test.ts's bin/hook.ts
// coverage: spawn the real hook binary against an isolated BEACON_HOME + a throwaway git repo.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The hook nudges only a repo already in Beacon's registry (it is installed globally and must never
// register one by reading a file in it) — the same workspaces.json lib/workspaces.ts reads.
function registerRepo(home: string, repo: string): void {
  const beaconHome = join(home, ".beacon");
  mkdirSync(join(beaconHome, idForPath(repo)), { recursive: true });
  writeFileSync(
    join(beaconHome, "workspaces.json"),
    JSON.stringify([{ id: idForPath(repo), path: repo, name: "repo", lastOpenedAt: new Date().toISOString() }]),
  );
}

function gitRepo(prefix: string): string {
  // realpathSync: on macOS tmpdir() sits under a symlink, and `git rev-parse --show-toplevel`
  // (which repoRootFrom uses) resolves it — the test's own path must match or the stamp dir
  // this test predicts won't be the one orient.ts actually wrote to.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  execSync("git init -q", { cwd: dir, stdio: "ignore" });
  return dir;
}

async function runOrient(opts: {
  home: string;
  cwd: string;
  event: Record<string, unknown>;
  env?: Record<string, string>;
}): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", join(ROOT, "bin", "orient.ts")],
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: opts.home,
      BEACON_HOME: join(opts.home, ".beacon"),
      ...opts.env,
    },
    stdin: new TextEncoder().encode(JSON.stringify({ cwd: opts.cwd, ...opts.event })),
    stdout: "pipe",
    stderr: "ignore",
  });
  const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  return { code, stdout: stdout.trim() };
}

function statsServer(body: unknown, status = 200) {
  return Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/api/code-graph/query" && url.searchParams.get("action") === "stats") {
        return Response.json(body as object, { status });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

describe("bin/orient.ts", () => {
  it("a non-matching tool_name produces no output", async () => {
    const home = mkdtempSync(join(tmpdir(), "beacon-orient-home-"));
    const repo = gitRepo("beacon-orient-repo-");
    try {
      const { code, stdout } = await runOrient({
        home,
        cwd: repo,
        event: { tool_name: "Bash", session_id: "sess-bash" },
        env: { BEACON_URL: "http://127.0.0.1:1" },
      });
      expect(code).toBe(0);
      expect(stdout).toBe("");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("Read with the daemon unreachable produces no output and exits 0", async () => {
    const home = mkdtempSync(join(tmpdir(), "beacon-orient-home-"));
    const repo = gitRepo("beacon-orient-repo-");
    try {
      const { code, stdout } = await runOrient({
        home,
        cwd: repo,
        event: { tool_name: "Read", session_id: "sess-unreachable" },
        env: { BEACON_URL: "http://127.0.0.1:1" },
      });
      expect(code).toBe(0);
      expect(stdout).toBe("");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("nudges once on a ready graph, then stays silent for the same session", async () => {
    const home = mkdtempSync(join(tmpdir(), "beacon-orient-home-"));
    const repo = gitRepo("beacon-orient-repo-");
    registerRepo(home, repo);
    const server = statsServer({ ok: true, symbols: 12, edges: 3, files: 2 });
    try {
      const first = await runOrient({
        home,
        cwd: repo,
        event: { tool_name: "Read", session_id: "sess-ok" },
        env: { BEACON_URL: `http://127.0.0.1:${server.port}` },
      });
      expect(first.code).toBe(0);
      const out = JSON.parse(first.stdout);
      expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
      expect(out.hookSpecificOutput.additionalContext).toContain("beacon query");
      expect(out.hookSpecificOutput.additionalContext).toContain("12");

      const stamp = join(home, ".beacon", idForPath(repo), "orient", "sess-ok");
      expect(existsSync(stamp)).toBe(true);

      // Second Read in the SAME session: the stamp already exists, so this must short-circuit
      // before ever hitting the (still-live, still-answering) mock daemon.
      const second = await runOrient({
        home,
        cwd: repo,
        event: { tool_name: "Grep", session_id: "sess-ok" },
        env: { BEACON_URL: `http://127.0.0.1:${server.port}` },
      });
      expect(second.code).toBe(0);
      expect(second.stdout).toBe("");
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("two concurrent calls for the SAME fresh session emit exactly one nudge (no TOCTOU double-nudge)", async () => {
    const home = mkdtempSync(join(tmpdir(), "beacon-orient-home-"));
    const repo = gitRepo("beacon-orient-repo-");
    registerRepo(home, repo);
    const server = statsServer({ ok: true, symbols: 12, edges: 3, files: 2 });
    try {
      // Claude Code can batch several Read/Grep/Glob calls from one turn, each spawning its own
      // orient process for the SAME session_id before either has written the stamp — the
      // existsSync fast path can't catch that race; only the exclusive stamp write can.
      const env = { BEACON_URL: `http://127.0.0.1:${server.port}` };
      const [a, b] = await Promise.all([
        runOrient({ home, cwd: repo, event: { tool_name: "Read", session_id: "sess-race" }, env }),
        runOrient({ home, cwd: repo, event: { tool_name: "Grep", session_id: "sess-race" }, env }),
      ]);
      expect(a.code).toBe(0);
      expect(b.code).toBe(0);
      const outputs = [a.stdout, b.stdout].filter((s) => s.length > 0);
      expect(outputs).toHaveLength(1);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("BEACON_ORIENT_OFF=1 suppresses the nudge even on a ready graph", async () => {
    const home = mkdtempSync(join(tmpdir(), "beacon-orient-home-"));
    const repo = gitRepo("beacon-orient-repo-");
    registerRepo(home, repo);
    const server = statsServer({ ok: true, symbols: 12, edges: 3, files: 2 });
    try {
      const { code, stdout } = await runOrient({
        home,
        cwd: repo,
        event: { tool_name: "Read", session_id: "sess-off" },
        env: { BEACON_URL: `http://127.0.0.1:${server.port}`, BEACON_ORIENT_OFF: "1" },
      });
      expect(code).toBe(0);
      expect(stdout).toBe("");
      const stamp = join(home, ".beacon", idForPath(repo), "orient", "sess-off");
      expect(existsSync(stamp)).toBe(false);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });
  it("a repo Beacon has never seen gets no nudge and no request — reading a file is not consent to index", async () => {
    const home = mkdtempSync(join(tmpdir(), "beacon-orient-home-"));
    const repo = gitRepo("beacon-orient-repo-");
    let hits = 0;
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        hits++;
        return Response.json({ ok: true, symbols: 12, edges: 3, files: 2 });
      },
    });
    try {
      const { code, stdout } = await runOrient({
        home,
        cwd: repo,
        event: { tool_name: "Read", session_id: "sess-unregistered" },
        env: { BEACON_URL: `http://127.0.0.1:${server.port}` },
      });
      expect(code).toBe(0);
      expect(stdout).toBe("");
      expect(hits).toBe(0);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("a negative answer is remembered: an empty graph stamps 'no' and the next call does not ask again", async () => {
    const home = mkdtempSync(join(tmpdir(), "beacon-orient-home-"));
    const repo = gitRepo("beacon-orient-repo-");
    registerRepo(home, repo);
    let symbols = 0;
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ ok: true, symbols, edges: 0, files: 1 }),
    });
    try {
      const env = { BEACON_URL: `http://127.0.0.1:${server.port}` };
      const first = await runOrient({ home, cwd: repo, event: { tool_name: "Read", session_id: "sess-no" }, env });
      expect(first.stdout).toBe("");
      const stamp = join(home, ".beacon", idForPath(repo), "orient", "sess-no");
      expect(readFileSync(stamp, "utf8")).toBe("no");
      symbols = 12; // the graph fills in — but the "no" is fresh, so this session is not re-asked
      const second = await runOrient({ home, cwd: repo, event: { tool_name: "Grep", session_id: "sess-no" }, env });
      expect(second.stdout).toBe("");
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
