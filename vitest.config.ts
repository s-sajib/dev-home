import { defineConfig } from "vitest/config";

// Run with Bun's runtime (`bun --bun vitest`) because the server uses bun:sqlite and Bun.spawn.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    environment: "node",
    pool: "forks",
    testTimeout: 15_000,
  },
});
