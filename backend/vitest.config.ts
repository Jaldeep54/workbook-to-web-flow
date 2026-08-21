import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Every file talks to the same in-memory database, so they run one at a
    // time rather than fighting over shared collections.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 60_000,
    setupFiles: [],
  },
});
