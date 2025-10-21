import { Page } from "@playwright/test";
import { TEST_USER } from "./testData";

/**
 * Authentication helper for E2E tests
 */

export interface TestUser {
	email: string;
	password: string;
	displayName?: string;
}

/**
 * Login via password authentication
 */
export async function login(page: Page, user: TestUser = TEST_USER): Promise<void> {
	// Navigate to home page
	await page.goto("/");

	// Click login button to open dialog
	await page.click('button:has-text("Log In"), a:has-text("Log In"), button:has-text("Login")');

	// Wait for login dialog to appear
	await page.waitForSelector('input[name="email"]', { state: "visible" });

	// Fill in credentials
	await page.fill('input[name="email"]', user.email);
	await page.fill('input[name="password"]', user.password);

	// Submit login form (HTMX sends HX-Redirect header on success)
	await page.click('button[type="submit"]:has-text("Log In"), button[type="submit"]:has-text("Login")');

	// Wait for successful login by checking for logout button
	// This is more reliable than waitForNavigation with HTMX redirects
	await page.waitForSelector('button:has-text("Log Out")', {
		timeout: 10000,
	});
}

/**
 * Logout the current user
 */
export async function logout(page: Page): Promise<void> {
	// Click logout link/button
	await page.click('a:has-text("Log Out"), button:has-text("Log Out"), form[action*="logout"] button');

	// Wait for redirect to home (logged out state)
	await page.waitForSelector('button:has-text("Log In"), a:has-text("Log In")');
}

/**
 * Check if user is currently logged in
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
	const logoutExists = (await page.locator('a:has-text("Log Out"), button:has-text("Log Out")').count()) > 0;
	return logoutExists;
}

/**
 * Ensure user is logged in (login if not already)
 */
export async function ensureLoggedIn(page: Page, user: TestUser = TEST_USER): Promise<void> {
	if (!(await isLoggedIn(page))) {
		await login(page, user);
	}
}
