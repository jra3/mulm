import { defineConfig, devices } from "@playwright/test";

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
	testDir: "./e2e",

	/* Global setup - creates test users and data */
	globalSetup: require.resolve("./e2e/global-setup"),

	/* Run tests in files in parallel */
	fullyParallel: true,

	/* Fail the build on CI if you accidentally left test.only in the source code. */
	forbidOnly: !!process.env.CI,

	/* Retry on CI only */
	retries: process.env.CI ? 2 : 0,

	/* Opt out of parallel tests on CI. */
	workers: process.env.CI ? 1 : undefined,

	/* Reporter to use. See https://playwright.dev/docs/test-reporters */
	reporter: process.env.CI
		? [["html"], ["github"], ["list"]]
		: [["html"], ["list"]],

	/* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
	use: {
		/* Base URL to use in actions like `await page.goto('/')`. */
		baseURL: process.env.BASE_URL || "http://localhost:4200",

		/* Collect trace on failure AND retry (more useful locally) */
		trace: process.env.CI ? "on-first-retry" : "retain-on-failure",

		/* Screenshot only on failure */
		screenshot: "only-on-failure",

		/* Video only on failure */
		video: "retain-on-failure",

		/* Enable HAR recording locally for network debugging (disabled in CI to save space) */
		...(process.env.CI ? {} : {
			contextOptions: {
				recordHar: {
					path: 'test-results/network-latest.har',
					mode: 'minimal',
					// Omit large content like images to keep file size reasonable
					omitContent: true
				}
			}
		}),
	},

	/* Configure projects for major browsers */
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},

		// Uncomment to test on Firefox and WebKit
		// {
		//   name: 'firefox',
		//   use: { ...devices['Desktop Firefox'] },
		// },

		// {
		//   name: 'webkit',
		//   use: { ...devices['Desktop Safari'] },
		// },

		/* Test against mobile viewports. */
		// {
		//   name: 'Mobile Chrome',
		//   use: { ...devices['Pixel 5'] },
		// },
		// {
		//   name: 'Mobile Safari',
		//   use: { ...devices['iPhone 12'] },
		// },
	],

	/* Run your local dev server before starting the tests */
	webServer: {
		command: "npm start",
		url: "http://localhost:4200/health",
		reuseExistingServer: !process.env.CI,
		timeout: 120 * 1000, // 2 minutes
		env: {
			NODE_ENV: "test",
		},
	},
});
