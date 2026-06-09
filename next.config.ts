import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
