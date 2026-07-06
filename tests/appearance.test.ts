import { expect, test, describe } from "bun:test";
import {
  coerceTheme,
  coerceSurface,
  resolveDark,
  THEME_SCRIPT,
  THEME_KEY,
  SURFACE_KEY,
  DEFAULT_THEME,
  DEFAULT_SURFACE,
} from "@/lib/appearance";

describe("coerceTheme", () => {
  test("passes through valid themes", () => {
    expect(coerceTheme("light")).toBe("light");
    expect(coerceTheme("dark")).toBe("dark");
    expect(coerceTheme("auto")).toBe("auto");
  });
  test("falls back to the default for junk/null", () => {
    expect(coerceTheme(null)).toBe(DEFAULT_THEME);
    expect(coerceTheme("")).toBe(DEFAULT_THEME);
    expect(coerceTheme("neon")).toBe(DEFAULT_THEME);
    expect(coerceTheme(undefined)).toBe(DEFAULT_THEME);
  });
});

describe("coerceSurface", () => {
  test("passes through valid surfaces", () => {
    expect(coerceSurface("glass")).toBe("glass");
    expect(coerceSurface("tinted")).toBe("tinted");
    expect(coerceSurface("solid")).toBe("solid");
  });
  test("falls back to the default for junk/null", () => {
    expect(coerceSurface(null)).toBe(DEFAULT_SURFACE);
    expect(coerceSurface("frosted")).toBe(DEFAULT_SURFACE);
  });
});

describe("resolveDark", () => {
  test("explicit dark/light ignore the system", () => {
    expect(resolveDark("dark", false)).toBe(true);
    expect(resolveDark("dark", true)).toBe(true);
    expect(resolveDark("light", true)).toBe(false);
    expect(resolveDark("light", false)).toBe(false);
  });
  test("auto follows the system preference", () => {
    expect(resolveDark("auto", true)).toBe(true);
    expect(resolveDark("auto", false)).toBe(false);
  });
});

describe("THEME_SCRIPT", () => {
  test("references both storage keys and both attributes", () => {
    expect(THEME_SCRIPT).toContain(THEME_KEY);
    expect(THEME_SCRIPT).toContain(SURFACE_KEY);
    // `dataset.theme`/`dataset.surface` set the data-theme/data-surface attributes.
    expect(THEME_SCRIPT).toContain("dataset.theme");
    expect(THEME_SCRIPT).toContain("dataset.surface");
    // Keeps the .dark class in sync for anything still keyed off it.
    expect(THEME_SCRIPT).toContain("classList");
    // Reads prefers-color-scheme so `auto` resolves before first paint.
    expect(THEME_SCRIPT).toContain("prefers-color-scheme");
  });
  test("bakes in the dark default so JS-off / fresh visitors stay dark", () => {
    expect(THEME_SCRIPT).toContain(`||"${DEFAULT_THEME}"`);
    expect(THEME_SCRIPT).toContain(`||"${DEFAULT_SURFACE}"`);
  });
});
