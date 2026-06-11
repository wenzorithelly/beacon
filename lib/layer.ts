// The frontend/backend layer axis for roadmap + architecture nodes. Pure (no db / no fs import)
// so BOTH the MCP server process and the /api routes can share one rule — same contract as
// lib/feature-rules.ts. The distinction only surfaces in workspaces that have a frontend
// (ProjectMeta.hasFrontend, resolved in lib/project-meta.ts).

export const LAYERS = ["frontend", "backend", "fullstack"] as const;
export type Layer = (typeof LAYERS)[number];

const ALIASES: Record<string, Layer> = {
  fe: "frontend",
  front: "frontend",
  be: "backend",
  back: "backend",
  fs: "fullstack",
  "full-stack": "fullstack",
  "full stack": "fullstack",
};

/** Case/spelling-tolerant parse of a layer value; anything unrecognized → null. */
export function normalizeLayer(v: string | null | undefined): Layer | null {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return null;
  if ((LAYERS as readonly string[]).includes(s)) return s as Layer;
  return ALIASES[s] ?? null;
}

// Display metadata for the layer badge + lane headers (client-safe — this module is pure).
export const LAYER_META: Record<Layer, { label: string; short: string }> = {
  frontend: { label: "Frontend", short: "FE" },
  backend: { label: "Backend", short: "BE" },
  fullstack: { label: "Fullstack", short: "FS" },
};

// Layer colors — the ONE place the frontend/backend hues live. Cool hues only: the warm
// half of the wheel (red/orange/amber) stays reserved for priority/status/brand (#ff7a45).
// Both are mutually distinguishable under common color-vision deficiencies (Okabe-Ito-derived,
// lightened for thin marks on near-black glass).
export const LAYER_COLORS: Record<Layer, string> = {
  frontend: "#5AC8FA", // sky blue
  backend: "#3ECF8E", // mint / server green
  fullstack: "#5AC8FA", // base hue; stripes/swatches render the blue+green split below
};

/** CSS background for a layer stripe/swatch: solid for FE/BE, a hard-stop vertical split
 *  (frontend blue on top, backend green below) for fullstack — "touches both", no third hue. */
export function layerStripeCss(layer: Layer): string {
  if (layer !== "fullstack") return LAYER_COLORS[layer];
  return `linear-gradient(to bottom, ${LAYER_COLORS.frontend} 0%, ${LAYER_COLORS.frontend} 50%, ${LAYER_COLORS.backend} 50%, ${LAYER_COLORS.backend} 100%)`;
}

// CodeFile.lang folds .tsx into "ts", so the deterministic "this repo has a frontend" signal
// is the file extension itself: any UI-component file means a frontend exists.
export const FRONTEND_FILE_RE = /\.(tsx|jsx|vue|svelte)$/i;

export function detectFrontendFromPaths(paths: string[]): boolean {
  return paths.some((p) => FRONTEND_FILE_RE.test(p));
}
