// A stable, distinct color per category (architecture domain / roadmap cluster) so the board
// reads at a glance. The category strings are free-form, so we hash the (uppercased) name into
// a fixed palette — same name → same color, every time. The class strings are FULL literals so
// Tailwind's content scan picks them up (interpolated class names would never be generated).

const PALETTE = [
  "bg-emerald-500/15 text-emerald-300",
  "bg-sky-500/15 text-sky-300",
  "bg-violet-500/15 text-violet-300",
  "bg-amber-500/15 text-amber-200",
  "bg-rose-500/15 text-rose-300",
  "bg-cyan-500/15 text-cyan-300",
  "bg-fuchsia-500/15 text-fuchsia-300",
  "bg-lime-500/15 text-lime-300",
  "bg-orange-500/15 text-orange-300",
  "bg-teal-500/15 text-teal-300",
  "bg-indigo-500/15 text-indigo-300",
  "bg-pink-500/15 text-pink-300",
] as const;

// Region surfaces (the group containers behind cards): the SAME palette index as the badge so
// a category's badge and its region read as one color family — double-encoding the grouping.
// Faint fills so cards stay legible on top. Full literals for the Tailwind content scan.
const REGION_PALETTE = [
  "border-emerald-500/20 bg-emerald-500/[0.04]",
  "border-sky-500/20 bg-sky-500/[0.04]",
  "border-violet-500/20 bg-violet-500/[0.04]",
  "border-amber-500/20 bg-amber-500/[0.04]",
  "border-rose-500/20 bg-rose-500/[0.04]",
  "border-cyan-500/20 bg-cyan-500/[0.04]",
  "border-fuchsia-500/20 bg-fuchsia-500/[0.04]",
  "border-lime-500/20 bg-lime-500/[0.04]",
  "border-orange-500/20 bg-orange-500/[0.04]",
  "border-teal-500/20 bg-teal-500/[0.04]",
  "border-indigo-500/20 bg-indigo-500/[0.04]",
  "border-pink-500/20 bg-pink-500/[0.04]",
] as const;

// Empty/unset category → neutral so the placeholder reads as "no category yet".
const NEUTRAL = "bg-white/[0.06] text-muted-foreground";
const NEUTRAL_REGION = "border-white/10 bg-white/[0.02]";

function paletteIndex(category: string | null | undefined): number | null {
  const key = (category ?? "").trim().toUpperCase();
  if (!key) return null;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % PALETTE.length;
}

/** Tailwind `bg`+`text` classes for a category, stable per name. */
export function categoryColorClass(category: string | null | undefined): string {
  const i = paletteIndex(category);
  return i === null ? NEUTRAL : PALETTE[i];
}

/** Tailwind `border`+`bg` classes for a category's group-region container, same hue as the badge. */
export function categoryRegionClass(category: string | null | undefined): string {
  const i = paletteIndex(category);
  return i === null ? NEUTRAL_REGION : REGION_PALETTE[i];
}

// Raw hex values of the same 12 hues (tailwind 400-ish), for places that need a real color
// value instead of a class — e.g. SVG/canvas dots on the Files graph.
const HEX_PALETTE = [
  "#34d399", // emerald
  "#38bdf8", // sky
  "#a78bfa", // violet
  "#fbbf24", // amber
  "#fb7185", // rose
  "#22d3ee", // cyan
  "#e879f9", // fuchsia
  "#a3e635", // lime
  "#fb923c", // orange
  "#2dd4bf", // teal
  "#818cf8", // indigo
  "#f472b6", // pink
] as const;

/** Hex color for a category, same hash/palette as the badge + region classes. */
export function categoryHex(category: string | null | undefined): string {
  const i = paletteIndex(category);
  return i === null ? "#9ca3af" : HEX_PALETTE[i];
}
