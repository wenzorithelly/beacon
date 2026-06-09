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

// Empty/unset category → neutral so the placeholder reads as "no category yet".
const NEUTRAL = "bg-white/[0.06] text-muted-foreground";

/** Tailwind `bg`+`text` classes for a category, stable per name. */
export function categoryColorClass(category: string | null | undefined): string {
  const key = (category ?? "").trim().toUpperCase();
  if (!key) return NEUTRAL;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
