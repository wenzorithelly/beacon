import { expect, test, describe } from "bun:test";
import { isDesktopShellValue, DESKTOP_SHELL } from "@/lib/shell";

describe("isDesktopShellValue", () => {
  test("true only for the exact desktop marker", () => {
    expect(isDesktopShellValue(DESKTOP_SHELL)).toBe(true);
    expect(isDesktopShellValue("desktop")).toBe(true);
  });
  test("false for web / absent / junk (case-sensitive)", () => {
    expect(isDesktopShellValue(undefined)).toBe(false);
    expect(isDesktopShellValue(null)).toBe(false);
    expect(isDesktopShellValue("")).toBe(false);
    expect(isDesktopShellValue("web")).toBe(false);
    expect(isDesktopShellValue("Desktop")).toBe(false);
  });
});
