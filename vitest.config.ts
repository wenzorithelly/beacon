import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    // Node by default (Prisma/libSQL data + server-action tests).
    // Component tests opt into jsdom with a `// @vitest-environment jsdom` docblock.
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    // Isolated test DB; dotenv in prisma.config.ts won't override an already-set var.
    env: {
      DATABASE_URL: "file:./test.db",
    },
    // One shared SQLite file. Run all files sequentially in a single worker and
    // disable module isolation so every file reuses the SAME libSQL connection
    // (the db singleton) — otherwise each file opens its own connection and they
    // deadlock on the shared test.db. (Vitest 4: these are top-level options.)
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    isolate: false,
  },
});
