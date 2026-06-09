// Single source of truth for distribution constants — imported by BOTH the public landing
// and the in-app update banner. Client-safe: plain strings + NEXT_PUBLIC env (no node APIs).

// The repo the installer pulls from and we check for new release tags.
export const REPO_SLUG = "wenzorithelly/beacon";

// Latest GitHub release (its tag_name). GitHub serves permissive CORS, so the browser can
// fetch this directly; a 404 (no releases cut yet) simply means "no banner".
export const GITHUB_LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO_SLUG}/releases/latest`;

// The canonical hosted site — serves the landing, /install.sh, and the feedback API the
// distributed tool calls cross-origin. MUST be the host that serves directly (no redirect):
// the apex trybeacon.sh 308-redirects to www, and a 308 on a CORS preflight fails the cross-origin
// POST (browsers don't follow redirects on preflight), so the feedback host is the www canonical.
// Override per-deploy with NEXT_PUBLIC_BEACON_SITE_URL.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_BEACON_SITE_URL ?? "https://www.trybeacon.sh"
).replace(/\/$/, "");

// The one install/update command shown on the landing AND copied by the update banner.
// Re-running the installer IS the update path (it git-fetches + resets the clone to latest).
export const INSTALL_COMMAND = `curl -fsSL ${SITE_URL}/install.sh | sh`;
