// Single source of truth for distribution constants — imported by BOTH the public landing
// and the in-app update banner. Client-safe: plain strings + NEXT_PUBLIC env (no node APIs).

// The repo the installer pulls from and we check for new release tags.
export const REPO_SLUG = "wenzorithelly/beacon";

// The npm package users actually install (`bun add -g trybeacon`).
export const NPM_PACKAGE = "trybeacon";

// Latest published version, straight from the npm registry (permissive CORS, public even
// though the GitHub repo is PRIVATE — a private repo 404s anonymous release lookups, which
// is why the banner must NOT read GitHub releases: it would never fire). npm is also the
// real source of truth: the update command installs from npm, not from a release tarball.
export const NPM_LATEST_URL = `https://registry.npmjs.org/${NPM_PACKAGE}/latest`;

// The canonical hosted site — serves the landing, /install.sh, and the deploy-side APIs (shared
// boards + telemetry) the distributed tool calls cross-origin. MUST be the host that serves
// directly (no redirect): the apex trybeacon.sh 308-redirects to www, and a 308 on a CORS preflight
// fails the cross-origin POST (browsers don't follow redirects on preflight), so www is canonical.
// Override per-deploy with NEXT_PUBLIC_BEACON_SITE_URL.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_BEACON_SITE_URL ?? "https://www.trybeacon.sh"
).replace(/\/$/, "");

// The one install/update command shown on the landing AND copied by the update banner.
// Re-running the installer IS the update path (it git-fetches + resets the clone to latest).
export const INSTALL_COMMAND = `curl -fsSL ${SITE_URL}/install.sh | sh`;
