import { test, expect } from "@playwright/test";

test.describe("Hello World - Basic Connectivity", () => {
	test("should load the application home page", async ({ page }) => {
		// Navigate to the home page
		await page.goto("/");

		// Wait for the page to load
		await page.waitForLoadState("networkidle");

		// Check that the page has loaded successfully (200 status)
		// and contains some expected content
		const bodyContent = await page.textContent("body");
		expect(bodyContent).toBeTruthy();
		expect(bodyContent!.length).toBeGreaterThan(0);

		// Check for common page elements
		const hasHeader = (await page.locator("header, nav, h1").count()) > 0;
		expect(hasHeader).toBeTruthy();
	});

	test("should have a login link or form", async ({ page }) => {
		await page.goto("/");

		// Check for login-related elements
		const hasLoginLink = await page.locator('a[href*="login"]').count();
		const hasLoginForm = await page.locator('form[action*="login"]').count();
		const hasLoginButton = await page.locator('button:has-text("Login"), button:has-text("Log In")').count();

		// At least one login element should exist
		expect(hasLoginLink + hasLoginForm + hasLoginButton).toBeGreaterThan(0);
	});

	test("should not have console errors on page load", async ({ page }) => {
		const consoleErrors: string[] = [];

		// Listen for console errors
		page.on("console", (msg) => {
			if (msg.type() === "error") {
				consoleErrors.push(msg.text());
			}
		});

		// Navigate to home page
		await page.goto("/");
		await page.waitForLoadState("networkidle");

		// Check for errors (filter out known benign errors if needed)
		const significantErrors = consoleErrors.filter(
			(error) =>
				// Filter out common benign errors
				!error.includes("favicon") && !error.includes("chrome-extension")
		);

		expect(significantErrors).toHaveLength(0);
	});

	test("should respond to health check endpoint", async ({ request }) => {
		const response = await request.get("/health");

		expect(response.ok()).toBeTruthy();
		expect(response.status()).toBe(200);

		const body = await response.json();
		expect(body).toHaveProperty("status");
	});
});
