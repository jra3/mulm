import { test, expect } from "@playwright/test";
import { selectTomSelectMultiple } from "./helpers/tomSelect";

test.describe("Tom Select Demo - Isolated Component Testing", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/test/tom-select-demo");
	});

	test("should load demo page with Tom Select fields", async ({ page }) => {
		// Verify page loaded
		await expect(page.locator("h1")).toContainText("Tom Select Component Testing");

		// Verify Tom Select fields are initialized
		await page.waitForSelector('select[name="foods"].tomselected', { timeout: 5000 });
		await page.waitForSelector('select[name="spawn_locations"].tomselected', { timeout: 5000 });
	});

	test("should select multiple foods using helper", async ({ page }) => {
		// Use our helper to select foods
		await selectTomSelectMultiple(page, "foods", ["Live Foods", "Flake"]);

		// Verify the display updated
		const displayText = await page.locator("#foods_value").textContent();
		console.log("Foods display shows:", displayText);

		// Verify the underlying select has the values
		const selectedValues = await page.locator('select[name="foods"]').evaluate((el: HTMLSelectElement) => {
			return Array.from(el.selectedOptions).map(o => o.value);
		});

		console.log("Selected values in <select>:", selectedValues);
		expect(selectedValues).toContain("Live Foods");
		expect(selectedValues).toContain("Flake");
	});

	test("should select spawn location using helper", async ({ page }) => {
		// Use our helper
		await selectTomSelectMultiple(page, "spawn_locations", ["Spawning Mop"]);

		// Verify selection
		const selectedValues = await page.locator('select[name="spawn_locations"]').evaluate((el: HTMLSelectElement) => {
			return Array.from(el.selectedOptions).map(o => o.value);
		});

		console.log("Spawn locations selected:", selectedValues);
		expect(selectedValues).toContain("Spawning Mop");
	});

	test("manual interaction - click and select", async ({ page }) => {
		// Try manual clicking to see what works
		// Click on the Tom Select control
		await page.click('select[name="foods"] + .ts-wrapper .ts-control');

		// Wait for dropdown
		await page.waitForTimeout(500);

		// Try to click an option - discover the correct selector
		// This test will help us see what structure actually exists
		const dropdown = page.locator('.ts-dropdown:visible');
		await expect(dropdown).toBeVisible({ timeout: 5000 });

		// Log the dropdown HTML for debugging
		const dropdownHTML = await dropdown.innerHTML();
		console.log("Dropdown HTML:", dropdownHTML);

		// Try clicking the first visible option
		await page.click('.ts-dropdown .option:has-text("Live Foods")');

		// Wait and verify
		await page.waitForTimeout(500);

		const selectedValues = await page.locator('select[name="foods"]').evaluate((el: HTMLSelectElement) => {
			return Array.from(el.selectedOptions).map(o => o.value);
		});

		console.log("After manual click, selected:", selectedValues);
		expect(selectedValues.length).toBeGreaterThan(0);
	});
});
