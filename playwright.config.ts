import { defineConfig, devices } from "@playwright/test";

const PORT = 3599;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: false, // one shared demo server; each test resets it first
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off", ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } },
  webServer: {
    command: "bun src/server/index.ts",
    env: { WORK_INBOX_DEMO: "1", PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/api/inbox`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
