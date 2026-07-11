import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  webServer: {
    command:
      "cd .. && KLH_FRONTEND_DIST=frontend/dist .venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8767",
    url: "http://127.0.0.1:8767/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8767",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
