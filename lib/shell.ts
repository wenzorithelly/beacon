// Desktop-shell seam. The private Electron shell marks the document root as
// `<html data-shell="desktop">` from a preload script that runs at document-start — BEFORE the app
// hydrates — so this signal is present on the very first client render (no flash, no hydration
// mismatch; <html> already carries suppressHydrationWarning). The web UI reads it to drop
// affordances the shell owns natively. Today that's the update banner (electron-updater installs
// updates in-app, so the banner's curl instructions are wrong there).
//
// Seam contract: the ONLY signal is the `data-shell` attribute on <html>. Anything that must behave
// differently in the desktop shell reads it here; pure CSS can key off `html[data-shell="desktop"]`
// directly. This module is pure + client-safe (no react, no node:fs) so it imports anywhere.

export const DESKTOP_SHELL = "desktop";

/** Pure: is this the desktop-shell marker value? Injectable so it unit-tests without a DOM. */
export function isDesktopShellValue(shell: string | null | undefined): boolean {
  return shell === DESKTOP_SHELL;
}

/** Client-only: read the marker the desktop preload set on <html>. SSR-safe (false on the server). */
export function isDesktopShell(): boolean {
  if (typeof document === "undefined") return false;
  return isDesktopShellValue(document.documentElement.dataset.shell);
}
