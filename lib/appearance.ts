// Appearance preferences — theme (light | dark | auto) and surface (glass | tinted | solid).
// Persisted in localStorage and applied to <html> as data-theme / data-surface (+ a .dark class
// kept in sync for anything still keyed off it). No database, no cookie — the inline no-flash
// script (see THEME_SCRIPT) reads localStorage before first paint, and AppearanceSync keeps
// `auto` following the OS live. This module is pure + client-safe (no react, no node:fs) so both
// the server layout (for THEME_SCRIPT) and client components can import it.

export type Theme = "light" | "dark" | "auto";
export type Surface = "glass" | "tinted" | "solid";

export const THEME_KEY = "beacon-theme";
export const SURFACE_KEY = "beacon-surface";

// The app shipped dark-only, so dark is the default — a fresh visitor (and JS-off) sees the
// look they always saw; only an explicit choice moves off it.
export const DEFAULT_THEME: Theme = "dark";
export const DEFAULT_SURFACE: Surface = "glass";

export const THEMES: readonly Theme[] = ["light", "dark", "auto"] as const;
export const SURFACES: readonly Surface[] = ["glass", "tinted", "solid"] as const;

/** Validate a stored/raw value into a Theme, falling back to the default. */
export function coerceTheme(v: unknown): Theme {
  return v === "light" || v === "dark" || v === "auto" ? v : DEFAULT_THEME;
}

/** Validate a stored/raw value into a Surface, falling back to the default. */
export function coerceSurface(v: unknown): Surface {
  return v === "glass" || v === "tinted" || v === "solid" ? v : DEFAULT_SURFACE;
}

/**
 * Resolve whether the effective palette is dark, given the preference and the OS setting.
 * `systemDark` is injected (testable); at runtime callers pass the matchMedia result.
 */
export function resolveDark(theme: Theme, systemDark: boolean): boolean {
  if (theme === "auto") return systemDark;
  return theme === "dark";
}

// Inline script string, run before first paint (in <head>) to set the theme with no flash. It
// must be fully self-contained — no imports — so the constants are interpolated in at build time.
export const THEME_SCRIPT = `(function(){try{var d=document.documentElement,t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)})||${JSON.stringify(DEFAULT_THEME)},s=localStorage.getItem(${JSON.stringify(
  SURFACE_KEY,
)})||${JSON.stringify(
  DEFAULT_SURFACE,
)},m=t==='dark'||(t==='auto'&&window.matchMedia('(prefers-color-scheme:dark)').matches);d.dataset.theme=m?'dark':'light';d.classList.toggle('dark',m);d.dataset.surface=s;}catch(e){}})();`;

// ── Client-only helpers (touch window/document/localStorage; never call on the server) ────────

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function getTheme(): Theme {
  try {
    return coerceTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function getSurface(): Surface {
  try {
    return coerceSurface(localStorage.getItem(SURFACE_KEY));
  } catch {
    return DEFAULT_SURFACE;
  }
}

/** Apply the resolved theme + surface to <html> (data-theme, .dark class, data-surface). */
export function applyAppearance(theme: Theme, surface: Surface): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  const dark = resolveDark(theme, systemPrefersDark());
  el.dataset.theme = dark ? "dark" : "light";
  el.classList.toggle("dark", dark);
  el.dataset.surface = surface;
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private-mode / disabled storage — still apply in-memory below */
  }
  applyAppearance(theme, getSurface());
}

export function setSurface(surface: Surface): void {
  try {
    localStorage.setItem(SURFACE_KEY, surface);
  } catch {
    /* ignore */
  }
  applyAppearance(getTheme(), surface);
}
