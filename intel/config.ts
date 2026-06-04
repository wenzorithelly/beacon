import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export interface IntelConfig {
  /** Directory the config lives in — roots/ignore resolve against it. */
  configDir: string;
  roots: string[];
  ignore: string[];
  databaseUrl?: string;
  openapiUrl?: string;
  controlUrl: string;
  // provider: "auto" prefers the Claude Code subscription (the `claude` CLI),
  // then an ANTHROPIC_API_KEY. Force with "claude-cli" or "api".
  llm: { provider: string; model: string; maxFiles: number; maxBytes: number };
}

const DEFAULTS = {
  roots: ["."],
  ignore: [
    "admin/**",
    "**/node_modules/**",
    "**/.git/**",
    "**/.next/**",
    "**/dist/**",
    "**/build/**",
    "**/__pycache__/**",
    "**/target/**",
    "**/*.lock",
    "**/*.lockb",
  ],
  controlUrl: "http://localhost:3000",
  // "auto" uses your Claude Code subscription (no API key) when the `claude` CLI is
  // present. Default model is Haiku — this runs on every save, so it's tuned for low
  // token spend; bump to "claude-sonnet-4-6" / "claude-opus-4-8" if extraction misses things.
  llm: { provider: "auto", model: "claude-haiku-4-5", maxFiles: 60, maxBytes: 400_000 },
};

function findConfig(explicit?: string): string | null {
  const chosen = explicit ?? process.env.INTEL_CONFIG;
  if (chosen) return isAbsolute(chosen) ? chosen : resolve(process.cwd(), chosen);
  // run from admin/ → config expected at juriscan_v2/juriscan.config.json (../)
  for (const c of ["../juriscan.config.json", "./juriscan.config.json"]) {
    const p = resolve(process.cwd(), c);
    if (existsSync(p)) return p;
  }
  return null;
}

export function loadConfig(explicit?: string): IntelConfig {
  const path = findConfig(explicit);
  const fileCfg = path ? JSON.parse(readFileSync(path, "utf8")) : {};
  // default config dir = parent of cwd (juriscan_v2) when no file found
  const configDir = path ? dirname(path) : resolve(process.cwd(), "..");
  return {
    configDir,
    roots: fileCfg.roots ?? DEFAULTS.roots,
    ignore: fileCfg.ignore ?? DEFAULTS.ignore,
    databaseUrl: fileCfg.databaseUrl ?? process.env.INTEL_DATABASE_URL,
    openapiUrl: fileCfg.openapiUrl ?? process.env.INTEL_OPENAPI_URL,
    controlUrl: fileCfg.controlUrl ?? DEFAULTS.controlUrl,
    llm: { ...DEFAULTS.llm, ...(fileCfg.llm ?? {}) },
  };
}
