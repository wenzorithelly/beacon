#!/usr/bin/env bun
/**
 * Beacon CLI — run `beacon` in any repo to open it in the local control panel.
 * One shared Beacon server (daemon) serves every repo you've opened; each repo keeps
 * its own data in ~/.beacon/<id>/. `beacon` registers the current repo, makes sure the
 * daemon + a per-repo watcher are running, then opens the browser on that repo.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file lives at <root>/bin/beacon.ts in the repo, but at <root>/dist/bin/beacon.js in a
// published build (bun build mirrors the source tree under dist/). So when our parent dir is
// `dist`, we're the packaged CLI and the package root is one level higher. In packaged mode the
// daemon runs the PRODUCTION server (`next start`) and Beacon modules load from dist/, not src.
const selfDir = dirname(fileURLToPath(import.meta.url)); // <root>/bin | <root>/dist/bin
const PACKAGED = basename(dirname(selfDir)) === "dist";
const pkgDir = PACKAGED ? dirname(dirname(selfDir)) : dirname(selfDir);
const cwd = process.cwd();
const BEACON_HOME = process.env.BEACON_HOME || join(homedir(), ".beacon");
const SERVER_FILE = join(BEACON_HOME, "server.json");
const PORT = process.env.PORT || "4319";

// Plugin mode: when this binary lives inside an installed Claude Code plugin payload (the plugin
// root carries .claude-plugin/plugin.json and we're at <root>/dist/bin/beacon.js), mark plugin
// mode so the global + per-repo self-heal is suppressed — the plugin already ships the skills,
// hooks, and MCP. Claude Code sets CLAUDE_PLUGIN_ROOT when IT spawns the plugin's hooks/MCP; we set
// it here too for the `/beacon` agent-bash path, which otherwise wouldn't have it and would
// re-write ~/.claude, double-registering every hook.
// …but ONLY when this binary actually lives inside an installed plugin payload (under
// ~/.claude/plugins/). The published npm package ALSO bundles .claude-plugin/plugin.json
// (build:plugin embeds it for the marketplace), so checking only for that file flagged every
// `bun add -g trybeacon` user as plugin-managed and suppressed their self-heal — new skills/MCP
// never installed. This path check (mirrors isInstalledPluginPath in lib/agent-config) tells a real
// plugin install apart from the npm CLI. Inlined (not imported) to keep the hot `beacon hook` path
// import-free.
const inPluginPayload = /[\\/]\.claude[\\/]plugins[\\/]/.test(selfDir);
if (
  !process.env.CLAUDE_PLUGIN_ROOT &&
  inPluginPayload &&
  existsSync(join(pkgDir, ".claude-plugin", "plugin.json"))
) {
  process.env.CLAUDE_PLUGIN_ROOT = pkgDir;
}

// The in-process db provisioner (lib/drizzle/provision) and the spawned server both resolve
// migrations from here — import.meta.url is unreliable once bundled / inside `.next`.
if (!process.env.BEACON_MIGRATIONS_DIR) process.env.BEACON_MIGRATIONS_DIR = join(pkgDir, "drizzle");

// Resolve a Beacon module by its source-relative path. Dev runs the TS sources directly; a
// published build runs the minified bundles under dist/, which mirror the source tree
// (bin/mcp.ts → dist/bin/mcp.js, lib/assets.ts → dist/lib/assets.js).
function mod(rel: string): string {
  if (!PACKAGED) return join(pkgDir, rel);
  return join(pkgDir, "dist", rel.replace(/\.ts$/, ".js"));
}

// Subcommands. Anything not listed falls through to `launchPanel()`, which opens the
// browser-side control panel for the current repo (the everyday `beacon` usage).
//   beacon mcp        — MCP stdio server (Claude Code spawns it via .mcp.json, Codex via ~/.codex/config.toml)
//   beacon hook       — PostToolUse hook handler (reports edits to the active feature)
//   beacon plan       — PermissionRequest hook handler (pipes ExitPlanMode → /plan)
//   beacon prompt     — UserPromptSubmit hook handler (nudges the feature loop)
//   beacon stop-hook  — Stop hook handler (nudges prose plan-approval → present on /plan)
//   beacon stop       — stop the shared daemon
//   beacon remove     — delete a workspace (unregister + wipe its ~/.beacon/<id>/ data)
//   beacon setup      — (re-)install per-repo skills + .mcp.json in CWD
//   beacon ensure     — plugin launcher: bring the daemon up for this repo, no browser (SessionStart)
//   beacon init-persist — /beacon-init's self-bootstrap fallback: wire the repo + POST the
//                       analysis JSON (file arg or stdin) to /api/init when the MCP tool is absent
//   beacon doctor     — audit install state (global hooks/skills + this repo's wiring)
//   beacon uninstall  — reverse every Beacon artifact (global + per-repo)
//   beacon update     — update the installed `trybeacon` package to the latest release
//   beacon telemetry  — anonymous usage telemetry: on | off | status (default status)
//   beacon version    — print the installed Beacon version (also --version / -v)
const sub = process.argv[2];
if (sub === "mcp") {
  await import(mod("bin/mcp.ts"));
} else if (sub === "hook") {
  await import(mod("bin/hook.ts"));
} else if (sub === "guard") {
  await import(mod("bin/guard.ts"));
} else if (sub === "plan") {
  await import(mod("bin/plan.ts"));
} else if (sub === "prompt") {
  await import(mod("bin/prompt.ts"));
} else if (sub === "stop-hook") {
  await import(mod("bin/stop-hook.ts"));
} else if (sub === "stop") {
  stopDaemon();
} else if (sub === "remove") {
  await import(mod("bin/remove.ts"));
} else if (sub === "setup") {
  await setupRepo(gitToplevel() || cwd);
} else if (sub === "ensure") {
  await ensurePanel();
} else if (sub === "init-persist") {
  await initPersist(process.argv[3]);
} else if (sub === "doctor") {
  await import(mod("bin/doctor.ts"));
} else if (sub === "uninstall") {
  await import(mod("bin/uninstall.ts"));
} else if (sub === "update") {
  await updateBeacon(process.argv.includes("--force") || process.argv.includes("-f"));
} else if (sub === "telemetry") {
  await telemetryCommand(process.argv[3]);
} else if (sub === "version" || sub === "--version" || sub === "-v") {
  console.log(currentVersion());
} else {
  await launchPanel();
}

// Install Beacon's helpers into a repo: skills + the MCP server registration.
// The user's agent sessions (Claude Code, Codex) then have:
//   • /beacon-init — read this repo and map it into Beacon (replaces the old `beacon init` CLI)
//   • /beacon-db-design — design schema for a feature and preview on /db
//   • beacon_* MCP tools — read the map, propose plans, register feature work
async function setupRepo(repo: string, quiet = false) {
  const { installInitSkill, installRefreshSkill, installCodexRepoSkills, ensureMcp, ensureWorkflowDoc } =
    await import(mod("lib/assets.ts"));
  const { selfHealGlobal, isPluginManaged } = await import(mod("lib/global-install.ts"));
  const { codexDetected } = await import(mod("lib/codex-install.ts"));
  // `beacon setup` is the explicit fix-it command — heal the global ~/.claude/ layer
  // (and ~/.codex when the Codex CLI is installed) here too so a user running it after
  // a manual cleanup doesn't have to also run bare `beacon` to re-trigger
  // launchPanel's global install.
  const heal = await selfHealGlobal();
  // Plugin mode: the installed plugin ships the skills + hooks + MCP globally, so don't write
  // competing per-repo files (.mcp.json, .claude/skills, the AGENTS.md workflow block) — that
  // would shadow the plugin's MCP server and duplicate its skills. selfHealGlobal already no-ops.
  if (isPluginManaged()) {
    return {
      initSkill: "",
      refreshSkill: "",
      mcp: { path: "", added: false, updated: false },
      codexSkills: [] as string[],
      heal,
    };
  }
  // `beacon update` re-execs `beacon setup` from whatever cwd the user ran it in. The global heal
  // above already ran; only wire the per-repo files (.mcp.json, .claude/skills, AGENTS.md block)
  // when we're actually inside a repo — never scatter them into a home / non-repo dir.
  const { isRegistrableWorkspacePath } = await import(mod("lib/workspaces.ts"));
  if (!isRegistrableWorkspacePath(repo)) {
    return {
      initSkill: "",
      refreshSkill: "",
      mcp: { path: "", added: false, updated: false },
      codexSkills: [] as string[],
      heal,
    };
  }
  const initSkill = installInitSkill(repo);
  const refreshSkill = installRefreshSkill(repo);
  ensureWorkflowDoc(repo);
  const mcp = ensureMcp(repo);
  // Codex reads repo AGENTS.md natively (no @import needed) and its MCP entry is
  // global (~/.codex/config.toml, written by the heal above) — only the repo-level
  // skills under .agents/skills are per-repo.
  const codexSkills: string[] = codexDetected() ? installCodexRepoSkills(repo) : [];
  if (quiet) {
    if (mcp.added || mcp.updated) {
      console.log(
        `[beacon] ${mcp.added ? "registered" : "updated"} Beacon MCP in ${mcp.path} — restart your agent CLI` +
          (mcp.updated ? " to apply the longer plan-review timeout." : " to use @beacon mentions."),
      );
    }
  } else {
    console.log(`\n  ◉ Beacon setup · ${repo}`);
    console.log(`  ✓ skill:  ${initSkill}`);
    console.log(`  ✓ skill:  ${refreshSkill}`);
    for (const s of codexSkills) console.log(`  ✓ skill:  ${s}`);
    console.log(`  ${mcp.added ? "✓ added " : "· kept  "} Beacon MCP in ${mcp.path}`);
    console.log(`  → in this repo, run /beacon-init in your agent (Claude Code or Codex) to map the repo.\n`);
  }
  return { initSkill, refreshSkill, mcp, codexSkills, heal };
}

// `beacon init-persist [file]` — the /beacon-init skill's bootstrap-and-persist fallback for a repo
// that was never opened with `beacon`. In that case .mcp.json is absent, so `beacon mcp` never
// started and the `beacon_init_persist` MCP tool isn't in the current agent session — and MCP tools
// can't be added mid-session. This command does what bare `beacon` does to WIRE the repo (install
// .mcp.json + skills, heal the global ~/.claude layer, start the daemon) and then POSTs the analysis
// the agent already produced straight to /api/init — the SAME endpoint the MCP tool hits — so
// /beacon-init completes in the CURRENT session. The next session then gets the beacon_* tools
// natively. The analysis JSON is read from `file`, or from stdin when no path is given.
async function initPersist(file?: string) {
  const repo = gitToplevel() || cwd;
  const { idForPath, isRegistrableWorkspacePath, BEACON_WS_PATH_HEADER } = await import(mod("lib/workspaces.ts"));
  if (!isRegistrableWorkspacePath(repo)) {
    console.error(
      `[beacon] refusing to init ${repo} — that's your home directory, not a project.\n` +
        "          cd into a repo (or run `git init` there) and try again.",
    );
    process.exit(1);
  }

  // Read the analysis payload FIRST so a missing/empty payload fails fast — before we wire anything
  // or spawn the daemon. fd 0 is stdin (the skill can pipe it instead of writing a temp file).
  let raw = "";
  try {
    raw = readFileSync(file ?? 0, "utf8").trim();
  } catch (e) {
    console.error(
      `[beacon] could not read the init analysis ${file ? `from ${file}` : "from stdin"}: ` +
        `${e instanceof Error ? e.message : e}`,
    );
    process.exit(1);
  }
  if (!raw) {
    console.error(
      "[beacon] empty init analysis — pass the JSON as a file argument (`beacon init-persist analysis.json`) or on stdin.",
    );
    process.exit(1);
  }

  // Wire the repo (idempotent): skills + .mcp.json + global self-heal, so the NEXT agent session
  // gets the beacon_* MCP tools natively. Then start (or find) the shared daemon — it serves
  // /api/init. Mirrors bare `beacon`, minus opening a browser.
  await setupRepo(repo, true);
  const port = await ensureDaemon();
  const id = idForPath(repo);

  // Same POST the MCP server makes. The path header makes /api/init register this workspace
  // (clearing any deletion tombstone) and provision its db before writing — so we don't here.
  let res: Response;
  try {
    res = await fetch(`http://localhost:${port}/api/init`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-beacon-workspace": id,
        [BEACON_WS_PATH_HEADER]: repo,
      },
      body: raw,
    });
  } catch (e) {
    console.error(`[beacon] could not reach the Beacon daemon on port ${port}: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  const text = await res.text();
  if (!res.ok) {
    console.error(`[beacon] init failed (HTTP ${res.status}): ${text}`);
    process.exit(1);
  }
  // Echo the result so the agent (running this via Bash) can read the counts and report them.
  console.log(`[beacon] mapped ${repo} into Beacon: ${text}`);
  console.log(`[beacon] open the panel → http://localhost:${port}/map`);
}

function gitToplevel(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function urlOk(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url: string, tries = 60): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await urlOk(url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// Start the shared server detached (survives this CLI exiting) and record its pid+port. The
// port is resolved by the caller (ensureDaemon) so a busy preferred port falls back to a free one.
function startDaemon(port: string): { pid: number; port: string } {
  mkdirSync(BEACON_HOME, { recursive: true });
  const log = openSync(join(BEACON_HOME, "server.log"), "a");
  // No BEACON_REPO → the server follows the active workspace (multi-workspace mode).
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: port,
    BEACON_NO_OPEN: "1",
    BEACON_MIGRATIONS_DIR: join(pkgDir, "drizzle"),
  };
  delete env.BEACON_REPO;
  delete env.BEACON_DATA_DIR;
  delete env.DATABASE_URL;
  // Packaged: serve the prebuilt `.next` in production (`next start`). Repo: hot-reloading dev.
  const args = PACKAGED ? ["run", "start"] : ["run", "dev"];
  const child = spawn("bun", args, {
    cwd: pkgDir,
    env,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  const info = { pid: child.pid ?? 0, port };
  writeFileSync(SERVER_FILE, JSON.stringify(info));
  return info;
}

async function ensureDaemon(): Promise<string> {
  const existing = readJson<{ pid: number; port: string }>(SERVER_FILE);
  if (existing && isAlive(existing.pid) && (await urlOk(`http://localhost:${existing.port}/api/workspace`))) {
    return existing.port;
  }
  // Pick a free port: if the preferred one (PORT / 4319) is taken by a stray process or another
  // app, scan upward so launch never wedges on "address in use". The chosen port is recorded in
  // server.json, which every other client (the MCP server, hooks, `beacon plan`) reads back.
  const { findAvailablePort } = await import(mod("lib/daemon-port.ts"));
  const port = String(await findAvailablePort(Number(PORT)));
  console.log(
    port === PORT
      ? "[beacon] starting the Beacon server…"
      : `[beacon] port ${PORT} is busy — starting the Beacon server on port ${port}…`,
  );
  const { port: started } = startDaemon(port);
  const ready = await waitForUrl(`http://localhost:${started}/api/workspace`);
  if (!ready) console.log("[beacon] (server is taking a while — it may still be compiling)");
  return started;
}

function openBrowser(url: string) {
  if (process.env.BEACON_NO_OPEN) return;
  const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  try {
    execSync(`${opener} "${url}"`, { stdio: "ignore" });
  } catch {
    /* no browser opener available */
  }
}

// `beacon ensure` — the plugin launcher's quiet bring-up. The plugin's SessionStart hook routes
// here (via bin/boot) so the shared daemon is running before the agent uses the MCP tools / hooks,
// WITHOUT opening a browser or printing the full launch banner (the plugin already wired the agent
// integration, so no setupRepo/self-heal here). A non-repo CWD (e.g. SessionStart fired in $HOME)
// is a graceful no-op, never an error.
async function ensurePanel() {
  const repo = gitToplevel() || cwd;
  const { registerWorkspaceExplicit, idForPath, ensureWorkspaceDb, isRegistrableWorkspacePath } =
    await import(mod("lib/workspaces.ts"));
  if (!isRegistrableWorkspacePath(repo)) return;
  const id = idForPath(repo);
  await ensureWorkspaceDb(id);
  registerWorkspaceExplicit(repo);
  const port = await ensureDaemon();
  console.log(`[beacon] ready → http://localhost:${port}/map?ws=${id}`);
}

async function launchPanel() {
  const repo = gitToplevel() || cwd;
  const { registerWorkspaceExplicit, idForPath, dataDirFor, ensureWorkspaceDb, isRegistrableWorkspacePath } =
    await import(mod("lib/workspaces.ts"));
  if (!isRegistrableWorkspacePath(repo)) {
    console.error(
      `[beacon] refusing to open Beacon in ${repo} — that's your home directory, not a project.\n` +
        "          cd into a repo (or run `git init` there) and try again.",
    );
    process.exit(1);
  }
  const id = idForPath(repo);
  const data = dataDirFor(id);

  // First run for this repo: create its database (in-process via libSQL — see
  // lib/drizzle/provision) + install Beacon's agent helpers.
  const firstRun = !existsSync(join(data, "db.sqlite"));
  if (firstRun) console.log(`[beacon] first run for ${repo} — creating database…`);
  const provisioned = await ensureWorkspaceDb(id);
  if (!provisioned.ok) {
    console.error(`[beacon] failed to provision database: ${provisioned.error}`);
  }
  if (firstRun) {
    console.log(
      "[beacon] tip: already have code here? run `/beacon-init` in your agent (Claude Code or Codex) to map the project.",
    );
  }

  // Always ensure Beacon's agent helpers are installed (idempotent): the skills + the
  // MCP registration, so @beacon mentions + the plan loop work in this repo. The
  // selfHeal inside also wires the GLOBAL layers — ~/.claude/ always, ~/.codex/ +
  // ~/.agents/ when the Codex CLI is detected. Prints only what actually changed.
  const { heal: g } = await setupRepo(repo, true);
  const globalChanges: string[] = [];
  if (g.skillsAdded.length) globalChanges.push(`skills ${g.skillsAdded.join(", ")}`);
  if (g.hooksAdded) globalChanges.push(`${g.hooksAdded} Claude Code hook${g.hooksAdded === 1 ? "" : "s"}`);
  if (g.claudeMdBlockTouched) globalChanges.push("global CLAUDE.md block");
  if (globalChanges.length)
    console.log(`[beacon] wired into ~/.claude/: ${globalChanges.join(" + ")}.`);
  const c = g.codex;
  if (c) {
    const codexChanges: string[] = [];
    if (c.skillsAdded.length) codexChanges.push(`skills ${c.skillsAdded.join(", ")}`);
    if (c.hooksAdded) codexChanges.push(`${c.hooksAdded} Codex hook${c.hooksAdded === 1 ? "" : "s"}`);
    if (c.agentsMdBlockTouched) codexChanges.push("global AGENTS.md block");
    if (c.mcp.added) codexChanges.push("MCP entry in config.toml");
    if (codexChanges.length)
      console.log(`[beacon] wired into ~/.codex/: ${codexChanges.join(" + ")}.`);
    if (c.mcp.error) console.log(`[beacon] codex MCP not wired: ${c.mcp.error}`);
  }

  // One-time telemetry disclosure — global trigger (no machine id yet), not per-repo. Runs
  // BEFORE ensureDaemon() so the daemon always finds the id on disk (it never writes
  // preferences itself). Printed even if an env opt-out is active: transparency first.
  try {
    const t = await import(mod("lib/telemetry.ts"));
    if (!t.telemetryStatus().machineId) {
      const enabled = t.telemetryStatus().enabled;
      console.log(
        "[beacon] telemetry: Beacon sends an anonymous heartbeat (random machine id, version, OS,\n" +
          "         architecture — never repo names, paths, or code) at most every 12h to count\n" +
          "         active installs. Opt out: `beacon telemetry off`, BEACON_TELEMETRY_DISABLED=1,\n" +
          `         or DO_NOT_TRACK=1. Details: beacon telemetry status.${enabled ? "" : " (currently disabled by your env)"}`,
      );
      t.ensureTelemetryId();
    }
  } catch {
    /* telemetry must never break launch */
  }

  // Register the repo, ensure the shared server, then open the browser straight onto this
  // repo (activate makes it the server's active workspace). The intel pipeline is MANUAL —
  // the user triggers it from Settings → "Sync code map" when they want fresh data.
  // Explicit register: opening a repo with `beacon` clears any prior deletion tombstone.
  registerWorkspaceExplicit(repo);
  const port = await ensureDaemon();
  void data;
  const base = `http://localhost:${port}`;
  // Pin the opened tab to THIS repo PER-TAB via `?ws=` (not just the browser-wide cookie) so it
  // keeps showing this repo even after another `beacon` run opens a different one. The redirect
  // still goes through activate (sets the cookie + provisions the db) for a freshly-opened tab.
  const mapPath = `/map?ws=${id}`;
  const activate = `${base}/api/workspace/activate?id=${id}&redirect=${encodeURIComponent(mapPath)}`;

  console.log(`\n  ◉ Beacon\n  repo:  ${repo}\n  data:  ${data}\n  url:   ${base}\n`);
  console.log("  (the server keeps running in the background — `beacon stop` to stop it)\n");

  // One tab per workspace: if a Beacon tab is already live for THIS repo, don't open another —
  // hand it a nav-intent (it picks it up over its SSE stream and navigates to /map) instead of
  // piling up duplicate tabs on every action. Presence is recorded server-side by the open
  // tab's stream; pinned to this repo via the x-beacon-workspace header. Unreachable or
  // never-opened → open a fresh tab as before.
  const tabLive = await fetch(`${base}/api/tab/presence`, {
    headers: { "x-beacon-workspace": id },
  })
    .then((r) => r.json())
    .then((p) => !!p?.live)
    .catch(() => false);
  if (tabLive) {
    await fetch(`${base}/api/tab/nav`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-beacon-workspace": id },
      body: JSON.stringify({ path: mapPath }),
    }).catch(() => {});
    console.log("  ↻ reusing your open Beacon tab — switch to your browser.\n");
  } else {
    openBrowser(activate);
  }
}

// The installed Beacon's own version (pkgDir/package.json), NOT the CWD repo's.
function currentVersion(): string {
  return readJson<{ version?: string }>(join(pkgDir, "package.json"))?.version ?? "0.0.0";
}

// `beacon telemetry [on|off|status]` — control + inspect the anonymous usage telemetry.
// `status` prints the EXACT payload that gets sent, so the disclosure is verifiable.
async function telemetryCommand(arg?: string) {
  const t = await import(mod("lib/telemetry.ts"));
  if (arg === "on" || arg === "off") {
    t.setTelemetryEnabled(arg === "on");
    console.log(`[beacon] telemetry ${arg === "on" ? "enabled" : "disabled"}.`);
    return;
  }
  if (arg && arg !== "status") {
    console.error("usage: beacon telemetry [on|off|status]");
    process.exit(1);
  }
  const s = t.telemetryStatus();
  const why =
    s.reason === "env:BEACON_TELEMETRY_DISABLED"
      ? " (BEACON_TELEMETRY_DISABLED=1)"
      : s.reason === "env:DO_NOT_TRACK"
        ? " (DO_NOT_TRACK)"
        : s.reason === "preference"
          ? " (beacon telemetry off)"
          : "";
  console.log(`\n  ◉ Beacon telemetry: ${s.enabled ? "enabled" : "disabled"}${why}`);
  console.log(`  machine id: ${s.machineId ?? "(not generated yet — created on first \`beacon\` run)"}`);
  if (s.machineId) {
    console.log(`  payload:    ${JSON.stringify(t.heartbeatPayload(currentVersion()))}`);
  }
  console.log(
    "  sent at most every 12h while the daemon runs — never repo names, paths, or code.\n" +
      "  toggle: `beacon telemetry on|off` · env: BEACON_TELEMETRY_DISABLED=1 or DO_NOT_TRACK=1\n",
  );
}

// `beacon update` — re-run the canonical installer (the documented update path: it pulls the
// latest `trybeacon` from npm and relinks). Skips the network reinstall when already current
// unless --force. Reuses INSTALL_COMMAND so the CLI, the landing page and the in-app update
// banner all agree on one command.
async function updateBeacon(force: boolean) {
  const current = currentVersion();
  const { INSTALL_COMMAND, NPM_LATEST_URL } = (await import(mod("lib/release.ts"))) as {
    INSTALL_COMMAND: string;
    NPM_LATEST_URL: string;
  };
  if (platform() === "win32") {
    console.log(`[beacon] current version v${current}.`);
    console.log(`[beacon] on Windows, update with your package manager:\n  npm i -g trybeacon@latest`);
    return;
  }
  let latest: string | null = null;
  try {
    const res = await fetch(NPM_LATEST_URL);
    if (res.ok) latest = ((await res.json()) as { version?: string }).version ?? null;
  } catch {
    /* offline / registry unreachable — fall through and just reinstall */
  }
  if (latest && !force) {
    const { isNewerVersion } = (await import(mod("lib/semver.ts"))) as {
      isNewerVersion: (a: string, b: string) => boolean;
    };
    if (!isNewerVersion(latest, current)) {
      console.log(`[beacon] already on the latest version (v${current}).`);
      console.log(`         run \`beacon update --force\` to reinstall anyway.`);
      return;
    }
  }
  console.log(
    latest
      ? `[beacon] updating Beacon v${current} → v${latest}…`
      : `[beacon] reinstalling Beacon (current v${current})…`,
  );
  try {
    execSync(INSTALL_COMMAND, { stdio: "inherit" });
  } catch {
    console.error(`[beacon] update failed. Run it manually:\n  ${INSTALL_COMMAND}`);
    process.exitCode = 1;
    return;
  }
  // Re-apply the global assets FROM the just-installed version so new skills (and changed ones),
  // hooks, and the MCP entry land immediately — not only on the next session. The running process is
  // still the OLD code, so re-exec the freshly-installed binary's heal (`beacon setup`, which heals
  // global always and wires the cwd repo when in one).
  try {
    execSync("beacon setup", { stdio: "inherit" });
  } catch {
    /* best effort — a bare `beacon` self-heals on next launch */
  }
  // npm `beacon update` doesn't touch a Claude Code PLUGIN install — update it too when present.
  await updateBeaconPlugin();
  // The shared daemon is still running the OLD code (and caches its version at startup, so the
  // in-app "new version" banner would keep showing). Drop it so the next `beacon` launches fresh.
  stopDaemon();
  console.log(`[beacon] updated. Run \`beacon\` to relaunch on the new version.`);
}

// Bring an installed Beacon Claude Code plugin up to the just-published version. Claude Code never
// auto-fetches npm-sourced plugins, so a plain `beacon update` (npm) would leave the plugin — and
// thus its skills/MCP — frozen. Refresh the marketplace catalog, then the plugin. Best-effort: a
// missing `claude` CLI or no installed plugin is a no-op (with a hint).
async function updateBeaconPlugin() {
  const { installedBeaconPlugin } = (await import(mod("lib/global-install.ts"))) as {
    installedBeaconPlugin: () => { key: string; marketplace: string } | null;
  };
  const plugin = installedBeaconPlugin();
  if (!plugin) return;
  try {
    execSync("command -v claude", { stdio: "ignore" });
  } catch {
    console.log(`[beacon] Beacon plugin detected — update it with:\n  claude plugin update ${plugin.key}`);
    return;
  }
  console.log(`[beacon] updating the Beacon Claude Code plugin (${plugin.key})…`);
  try {
    if (plugin.marketplace) execSync(`claude plugin marketplace update ${plugin.marketplace}`, { stdio: "inherit" });
    execSync(`claude plugin update ${plugin.key}`, { stdio: "inherit" });
    console.log("[beacon] plugin updated — restart your agent to apply.");
  } catch {
    console.log(`[beacon] couldn't auto-update the plugin. Run:\n  claude plugin update ${plugin.key}`);
  }
}

function stopDaemon() {
  const info = readJson<{ pid: number }>(SERVER_FILE);
  if (info && isAlive(info.pid)) {
    try {
      // The daemon is spawned detached → it leads its own process GROUP. Signal the group:
      // killing only the leader orphans the next-server child, which keeps holding write
      // locks on the workspace dbs for hours (agents then see opaque SQLITE_BUSY 500s).
      try {
        process.kill(-info.pid);
      } catch {
        process.kill(info.pid);
      }
      console.log(`[beacon] stopped the server (pid ${info.pid}).`);
    } catch {
      console.log("[beacon] could not stop the server.");
    }
  } else {
    console.log("[beacon] no server running.");
  }
}
