import chokidar from "chokidar";
import { resolve } from "node:path";
import { loadConfig } from "@/intel/config";
import { runPipeline } from "@/intel/pipeline";

// CLI entry: `bun run intel/watch.ts` (or `make watch`). Watches the repo's
// source and keeps Beacon's DB-design + code-graph maps live as you code.

const config = loadConfig();
const roots = config.roots.map((r) => resolve(config.configDir, r));

console.log(`[intel] watching: ${roots.join(", ")}`);
console.log(
  `[intel] control=${config.controlUrl} (deterministic sync) openapi=${config.openapiUrl ?? "none"}`,
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
    const cyc = r.codeCircular > 0 ? ` (${r.codeCircular} circular)` : "";
    console.log(
      `[intel] ${r.ok ? "synced" : `FAILED(${r.status})`}: ` +
        `${r.files} files · ${r.tables} tables · ${r.endpoints} endpoints · ` +
        `${r.codeFiles} code-files / ${r.codeEdges} imports${cyc}`,
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
