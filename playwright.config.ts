import { defineConfig, devices } from "@playwright/test";

// Mutation tests always own their local server/database. Remote smoke tests must
// use a separate configuration and may not import the mutation fixtures.
if (process.env.BASE_URL) throw new Error("BASE_URL is not supported by disposable E2E tests");
process.env.NODE_ENV = "test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["github"], ["list"]]
    : [["html", { open: "never" }], ["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
