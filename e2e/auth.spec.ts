import { test, expect } from "@playwright/test";
import { login, logout, isLoggedIn } from "./helpers/auth";

test.describe("Authentication Flow", () => {
	test("should successfully login with password", async ({ page }) => {
		// Login
		await login(page);

		// Verify logged in state
		const loggedIn = await isLoggedIn(page);
		expect(loggedIn).toBe(true);

		// Verify logout button is visible
		const logoutButton = page.locator('button:has-text("Log Out")');
		await expect(logoutButton).toBeVisible();
	});

	test("should successfully logout", async ({ page }) => {
		// Login first
		await login(page);

		// Logout
		await logout(page);

		// Verify logged out state
		const loggedIn = await isLoggedIn(page);
		expect(loggedIn).toBe(false);

		// Verify login button is visible
		const loginButton = page.locator('button:has-text("Log In")');
		await expect(loginButton).toBeVisible();
	});
});
