// Tiny, dependency-free semver compare for the update-available check. We only need
// "is the latest release strictly newer than what's running" over the core x.y.z —
// prerelease/build metadata is ignored so we never nag on a prerelease of the same core.
// Client-safe (pure string math, no node APIs) so the update banner can use it.

export function parseVersion(v: string): [number, number, number] | null {
  if (typeof v !== "string") return null;
  const m = v.trim().replace(/^v/i, "").match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false; // unparseable → don't nag
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}
