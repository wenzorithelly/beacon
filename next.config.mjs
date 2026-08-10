// Plain ESM, deliberately NOT next.config.ts.
//
// A TypeScript config forces `next start` to load the SWC compiler purely to transpile THIS FILE at
// boot — a 115MB native binary (@next/swc-<platform>) that does nothing else in a production start,
// because the app is served from a prebuilt .next. In the Beacon desktop app that binary is ~20% of
// the entire shipped bundle, and it cannot simply be pruned while this file is TypeScript: dropping it
// made the bundled backend crash on launch (2026-07-11), since the sandboxed app has no npm and no
// writable cache to fetch the WASM fallback into.
//
// Measured 2026-08-10 against the shipped tree with @next/swc-darwin-arm64 deleted and HOME redirected
// so no cached copy was reachable:
//   next.config.ts  → "Downloading swc package @next/swc-darwin-arm64…"  (the 2026-07-11 crash path)
//   next.config.mjs → Ready in 92ms, /map returns 200, zero swc references
// Server node_modules: 303MB → 187MB.
//
// Keep this file plain JS. The JSDoc type below gives the same editor completion and checking that the
// `NextConfig` import gave, at no runtime cost.

/** @type {import("next").NextConfig} */
const nextConfig = {
  // Keep the native libSQL driver + Prisma runtime out of the bundle (server-only).
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-libsql",
    "@libsql/client",
    "libsql",
  ],
  // Hide the Next.js dev-mode "N" overlay button that intercepts clicks at the bottom-right.
  devIndicators: false,
};

export default nextConfig;
