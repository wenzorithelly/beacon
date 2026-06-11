// Semantic-zoom level-of-detail thresholds. Below ~0.55 a card's body text is physically
// unreadable, so we swap to title-only rendering; below ~0.3 even titles are specks, so cards
// hide and each group region renders one summary block instead — zoomed out you read structure,
// zoomed in you read detail. Hysteresis (enter/exit thresholds differ) so hovering exactly on a
// boundary never flickers between levels. Pure so the thresholds are unit-tested; the React hook
// lives in components/graph/use-zoom-lod.ts.

export type Lod = "full" | "mid" | "far";

export interface LodThresholds {
  far: number;
  farExit: number;
  mid: number;
  midExit: number;
}

// Card boards (roadmap / architecture / db): cards are ~300px wide, unreadable below ~0.55.
export const ZOOM_MID = 0.55; // below: title-only cards
export const ZOOM_MID_EXIT = 0.6; // back above: full cards again
export const ZOOM_FAR = 0.3; // below: cards hide, group summaries show
export const ZOOM_FAR_EXIT = 0.34; // back above: title-only cards again

const DEFAULT_THRESHOLDS: LodThresholds = {
  far: ZOOM_FAR,
  farExit: ZOOM_FAR_EXIT,
  mid: ZOOM_MID,
  midExit: ZOOM_MID_EXIT,
};

// The Files dot graph stays readable much further out (dots + color groups, not text cards),
// so its summaries only take over when the user really zooms away.
export const FILES_LOD: LodThresholds = { far: 0.12, farExit: 0.15, mid: 0.45, midExit: 0.5 };

// The DB board fits the WHOLE schema at ~0.38 zoom (fitView minZoom). At the default 0.55 mid
// threshold every table collapses to a name-only pill there, which hides the schema's shape.
// Lower thresholds keep full table cards — header + columns — readable down to the fit level so
// the user reads the schema as a whole; only zooming further out collapses to pills/summaries.
export const DB_LOD: LodThresholds = { far: 0.2, farExit: 0.24, mid: 0.32, midExit: 0.36 };

export function lodForZoom(
  zoom: number,
  prev: Lod = "full",
  t: LodThresholds = DEFAULT_THRESHOLDS,
): Lod {
  if (zoom < t.far) return "far";
  if (prev === "far" && zoom < t.farExit) return "far";
  if (zoom < t.mid) return "mid";
  if (prev === "mid" && zoom < t.midExit) return "mid";
  return "full";
}
