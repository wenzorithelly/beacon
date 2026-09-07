#!/usr/bin/env bun
/**
 * `beacon query|explain|affected|path` — CLI verbs over the symbol graph, talking to
 * app/api/code-graph/query/route.ts on the running daemon. Dispatched from bin/beacon.ts, which
 * leaves argv untouched (process.argv[2] is still the verb) before importing this file.
 *
 *   beacon query "<question>" [--dfs] [--depth N] [--budget N] [--json]
 *   beacon explain <symbol> [--json]
 *   beacon affected <symbol> [--depth N] [--json]
 *   beacon path <A> <B> [--undirected] [--json]
 */
import { agentWorkspaceHeaders } from "@/lib/workspaces";
import { daemonBaseUrl } from "@/lib/daemon-server";

const USAGE = [
  "Usage:",
  '  beacon query "<question>" [--dfs] [--depth N] [--budget N] [--json]',
  "  beacon explain <symbol> [--json]",
  "  beacon affected <symbol> [--depth N] [--json]",
  "  beacon path <A> <B> [--undirected] [--json]",
].join("\n");

function usage(): never {
  process.stderr.write(USAGE + "\n");
  process.exit(3);
}

function flagNum(args: string[], name: string): number | undefined {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return undefined;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) ? n : undefined;
}

const verb = process.argv[2];
const args = process.argv.slice(3);
const positional = args.filter((a) => !a.startsWith("--"));
const json = args.includes("--json");

const qs = new URLSearchParams();
if (verb === "query") {
  const question = positional[0];
  if (!question) usage();
  qs.set("action", "query");
  qs.set("q", question);
  if (args.includes("--dfs")) qs.set("mode", "dfs");
  const depth = flagNum(args, "--depth");
  if (depth != null) qs.set("depth", String(depth));
  const budget = flagNum(args, "--budget");
  if (budget != null) qs.set("budget", String(budget));
} else if (verb === "explain") {
  if (!positional[0]) usage();
  qs.set("action", "explain");
  qs.set("q", positional[0]);
} else if (verb === "affected") {
  if (!positional[0]) usage();
  qs.set("action", "affected");
  qs.set("q", positional[0]);
  const depth = flagNum(args, "--depth");
  if (depth != null) qs.set("depth", String(depth));
} else if (verb === "path") {
  const [a, b] = positional;
  if (!a || !b) usage();
  qs.set("action", "path");
  qs.set("from", a);
  qs.set("to", b);
  if (args.includes("--undirected")) qs.set("undirected", "1");
} else {
  usage();
}

let res: Response;
try {
  res = await fetch(`${daemonBaseUrl()}/api/code-graph/query?${qs.toString()}`, { headers: agentWorkspaceHeaders() });
} catch {
  process.stderr.write("Beacon is not running — run `beacon` once in this repo, then retry.\n");
  process.exit(1);
}

const raw = await res.text();
if (json) {
  process.stdout.write(raw + "\n");
  process.exit(res.ok ? 0 : 1);
}

let body: { text?: string; error?: string } = {};
try {
  body = raw ? JSON.parse(raw) : {};
} catch {
  body = { text: raw };
}

if (!res.ok) {
  process.stderr.write((body.text ?? body.error ?? `Beacon returned ${res.status}`) + "\n");
  process.exit(1);
}
process.stdout.write((body.text ?? "") + "\n");
