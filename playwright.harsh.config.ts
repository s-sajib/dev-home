import { defineConfig, devices } from "@playwright/test";

const PORT = 3598;

/** Stress suite: hostile 14k-event dataset, failing sources, injected latency/500s/hangs, crash + restart. */
export default defineConfig({
  testDir: "e2e-harsh",
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off", ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  webServer: {
    command: "rm -f data/harsh-e2e.db data/harsh-e2e.db-shm data/harsh-e2e.db-wal && bun scripts/supervise.ts bun src/server/index.ts",
    env: { WORK_INBOX_DEMO: "harsh", PORT: String(PORT), WORK_INBOX_DB: "data/harsh-e2e.db" },
    url: `http://127.0.0.1:${PORT}/api/demo/ping`,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
