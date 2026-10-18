import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests run against the docker-compose stack started with
 * docker-compose.e2e.yml (AUTH_TEST_MODE=true). See docs/testing.md.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "pixel-7", use: { ...devices["Pixel 7"] } },
    // iPhone 14 viewport and user agent, rendered with Chromium.
    { name: "iphone-14", use: { ...devices["iPhone 14"], browserName: "chromium", defaultBrowserType: "chromium" } },
  ],
});
