import chokidar from "chokidar";
import { resolve } from "node:path";
import { loadConfig } from "@/intel/config";
import { runPipeline } from "@/intel/pipeline";
import { resolveProvider } from "@/intel/extract";

// CLI entry: `bun run intel/watch.ts` (or `make watch`). Watches the Juriscan
// source and keeps the control app's DB-design map live as you code.

const config = loadConfig();
const roots = config.roots.map((r) => resolve(config.configDir, r));
const provider = resolveProvider(config);
const providerLabel =
  provider === "claude-cli"
    ? "claude-cli (Claude Code subscription)"
    : provider === "api"
      ? "api (ANTHROPIC_API_KEY)"
      : "none (deterministic only)";

console.log(`[intel] watching: ${roots.join(", ")}`);
console.log(
  `[intel] control=${config.controlUrl} model=${config.llm.model} (default; live via UI dropdown) ` +
    `provider=${providerLabel} openapi=${config.openapiUrl ?? "none"}`,
);

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, 600);
}

async function run() {
  if (running) return schedule();
  running = true;
  try {
    const r = await runPipeline(config);
    console.log(
      `[intel] ${r.ok ? "synced" : `FAILED(${r.status})`}: ` +
        `${r.files} files · ${r.tables} tables · ${r.endpoints} endpoints ` +
        `[${r.provider} · ${r.model}]`,
    );
  } catch (e) {
    console.error("[intel] pipeline error:", e instanceof Error ? e.message : e);
  } finally {
    running = false;
  }
}

const IGNORE =
  /[/\\](node_modules|\.git|\.next|admin|__pycache__|target|dist|build|\.venv|venv)[/\\]/;

const watcher = chokidar.watch(roots, {
  ignored: (p: string) => IGNORE.test(p),
  ignoreInitial: true,
  persistent: true,
});

watcher.on("ready", () => {
  console.log("[intel] initial sync…");
  void run();
});
watcher.on("all", () => schedule());
