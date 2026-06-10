// Semantic-zoom level-of-detail thresholds. Below ~0.55 a card's body text is physically
// unreadable, so we swap to title-only rendering; below ~0.3 even titles are specks, so cards
// hide and each group region renders one summary block instead — zoomed out you read structure,
// zoomed in you read detail. Hysteresis (enter/exit thresholds differ) so hovering exactly on a
// boundary never flickers between levels. Pure so the thresholds are unit-tested; the React hook
// lives in components/graph/use-zoom-lod.ts.

export type Lod = "full" | "mid" | "far";

export const ZOOM_MID = 0.55; // below: title-only cards
export const ZOOM_MID_EXIT = 0.6; // back above: full cards again
export const ZOOM_FAR = 0.3; // below: cards hide, group summaries show
export const ZOOM_FAR_EXIT = 0.34; // back above: title-only cards again

export function lodForZoom(zoom: number, prev: Lod = "full"): Lod {
  if (zoom < ZOOM_FAR) return "far";
  if (prev === "far" && zoom < ZOOM_FAR_EXIT) return "far";
  if (zoom < ZOOM_MID) return "mid";
  if (prev === "mid" && zoom < ZOOM_MID_EXIT) return "mid";
  return "full";
}
