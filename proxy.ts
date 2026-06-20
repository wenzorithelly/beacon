import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Beacon is one codebase, two modes:
//
//   LOCAL (default) — the `beacon` CLI tool, bound to localhost. The people using it
//   are already users, so `/` opens the tool directly; the marketing landing is never
//   shown. Every tool route + /api is served normally.
//
//   PUBLIC (BEACON_PUBLIC=1, OR any Vercel deploy — Vercel sets VERCEL=1 in every
//   build + runtime env, prod and preview alike, e.g. a beacon.dev deploy) — ONLY the
//   landing at `/` is served. The local tool's routes and its /api (which read the
//   developer's own repo data) are NEVER exposed: everything else redirects back to `/`.
//   The local `beacon` CLI never sets VERCEL, so it stays in LOCAL mode.
const PUBLIC =
  process.env.BEACON_PUBLIC === "1" || process.env.VERCEL === "1";

// The exact set of paths that stay reachable on the public deploy. `/` is the landing; `/docs`
// the public guide; `/install.sh` the install script (served from public/); `/api/telemetry*` the
// anonymous heartbeat ingest — called by every distributed install cross-origin. `/s/*` is a shared
// read-only board view and `/api/share` (exact — NOT the local-only `/api/share/create`) is the
// snapshot ingest those links post to. Everything else (the local tool's routes + the rest of /api,
// which read the developer's own repo data) stays hidden and redirects to `/`.
export function publicPathAllowed(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/docs" ||
    pathname === "/install.sh" ||
    pathname === "/api/share" ||
    pathname.startsWith("/s/") ||
    pathname.startsWith("/api/telemetry")
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC) {
    if (publicPathAllowed(pathname)) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Local: users never see the landing — send `/` straight into the app.
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/map?view=ROADMAP", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static brand/icon assets so they
  // always load (otherwise the landing's own CSS/JS/fonts could get redirected).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|brand/).*)"],
};
