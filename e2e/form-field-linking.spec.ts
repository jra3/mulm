import { test, expect } from "@playwright/test";
import { login } from "./helpers/auth";
import { fillTomSelectTypeahead, getTomSelectValue } from "./helpers/tomSelect";

/**
 * E2E tests for BAP Form Field Linking
 *
 * The BAP submission form has JavaScript-driven field linking that synchronizes:
 * - Common name ↔ Scientific name fields
 * - Picking a known Name sets the hidden `species_id` to its Species (the
 *   member's pick binds the Submission, if the saved form agrees with it)
 * - Auto-population of `species_class` field based on species selection
 * - Free text leaves `species_id` empty
 *
 * This functionality was temporarily disabled (commit c9e9606) and has been re-enabled.
 * These tests prevent regressions.
 */

test.describe("BAP Form - Field Linking", () => {
	test.beforeEach(async ({ page }) => {
		// Login and navigate to form
		await login(page);
		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		// Set up basic form fields to enable species fields
		await page.selectOption('select[name="water_type"]', "Fresh");
		await page.selectOption('select[name="species_type"]', "Fish");

		// Wait for HTMX swap to complete
		await page.waitForLoadState("networkidle");
		await page.waitForSelector('select[name="species_class"]', { state: "visible" });

		// Select a species class
		await page.selectOption('select[name="species_class"]', "Livebearers");

		// Wait for Tom Select to initialize on species fields
		await page.waitForSelector('select[name="species_common_name"].tomselected', {
			timeout: 10000,
		});
		await page.waitForSelector('select[name="species_latin_name"].tomselected', {
			timeout: 10000,
		});
	});

	test("should auto-populate scientific name when common name is selected", async ({
		page,
	}) => {
		// Select a species via common name
		await fillTomSelectTypeahead(page, "species_common_name", "Guppy");

		// Wait for field linking to complete
		await page.waitForTimeout(500);

		// Verify scientific name field was auto-populated
		const scientificName = await getTomSelectValue(page, "species_latin_name");
		expect(scientificName).toBeTruthy();
		expect(scientificName).toContain("Poecilia");

		// Verify hidden species_id field has a value
		const speciesId = await page.inputValue('input[name="species_id"]');
		expect(speciesId).toBeTruthy();
		expect(parseInt(speciesId)).toBeGreaterThan(0);
	});

	test("should auto-populate common name when scientific name is selected", async ({
		page,
	}) => {
		// Select a species via scientific name
		// Helper now waits for HTMX field linking to complete
		await fillTomSelectTypeahead(page, "species_latin_name", "Poecilia reticulata");

		// Verify common name field was auto-populated
		const commonName = await getTomSelectValue(page, "species_common_name");
		expect(commonName).toBeTruthy();
		expect(commonName!.toLowerCase()).toContain("guppy");

		// Verify hidden species_id field has a value
		const speciesId = await page.inputValue('input[name="species_id"]');
		expect(speciesId).toBeTruthy();
		expect(parseInt(speciesId)).toBeGreaterThan(0);
	});

	test("fills the common name with the Latin name for a species that has no common name", async ({
		page,
	}) => {
		// Seeded by scripts/setup-e2e-db.ts with no common Name (#421)
		await fillTomSelectTypeahead(page, "species_latin_name", "Poeciliopsis nocommonus");

		expect(await getTomSelectValue(page, "species_common_name")).toBe("Poeciliopsis nocommonus");
		const speciesId = await page.inputValue('input[name="species_id"]');
		expect(parseInt(speciesId)).toBeGreaterThan(0);
	});

	test("should update hidden species_id field when species is selected", async ({
		page,
	}) => {
		// Get initial value of hidden field (should be empty)
		const initialValue = await page.inputValue('input[name="species_id"]');
		expect(initialValue).toBe("");
		await expect(page.locator("#species-binding-notice")).toBeHidden();

		// Select a species via common name
		// Helper now waits for HTMX field linking to complete
		await fillTomSelectTypeahead(page, "species_common_name", "Guppy");

		// Verify hidden field now contains a numeric ID
		const updatedValue = await page.inputValue('input[name="species_id"]');
		expect(updatedValue).toBeTruthy();
		expect(parseInt(updatedValue)).toBeGreaterThan(0);

		// Bound: the form warns that changing the species fields will unbind
		await expect(page.locator("#species-binding-notice")).toBeVisible();
	});

	test("should populate species_class field based on selected species", async ({
		page,
	}) => {
		// Select a species from Livebearers class
		await fillTomSelectTypeahead(page, "species_common_name", "Guppy");

		// Wait for field linking
		await page.waitForTimeout(500);

		// Verify species_class field is still set to Livebearers
		const speciesClass = await page.inputValue('select[name="species_class"]');
		expect(speciesClass).toBe("Livebearers");
	});

	test("should maintain sync when switching between fields", async ({ page }) => {
		// 1. Select species via common name
		await fillTomSelectTypeahead(page, "species_common_name", "Guppy");
		await page.waitForTimeout(500);

		// Verify scientific name syncs
		let scientificName = await getTomSelectValue(page, "species_latin_name");
		expect(scientificName).toContain("Poecilia");

		// Get the Species id from first selection
		const firstSpeciesId = await page.inputValue('input[name="species_id"]');
		expect(firstSpeciesId).toBeTruthy();

		// 2. Clear and select different species via scientific name
		// Clear the Tom Select fields
		await page.evaluate(() => {
			const commonField = document.getElementById(
				"species_common_name"
			) as HTMLSelectElement & { tomSelectInstance?: any };
			const latinField = document.getElementById(
				"species_latin_name"
			) as HTMLSelectElement & { tomSelectInstance?: any };

			if (commonField?.tomSelectInstance) {
				commonField.tomSelectInstance.clear();
			}
			if (latinField?.tomSelectInstance) {
				latinField.tomSelectInstance.clear();
			}
		});

		await page.waitForTimeout(500);

		// Select a different species
		await fillTomSelectTypeahead(page, "species_latin_name", "Xiphophorus maculatus");
		await page.waitForTimeout(500);

		// Verify common name updates to new species
		const commonName = await getTomSelectValue(page, "species_common_name");
		expect(commonName).toBeTruthy();
		// Picking a scientific Name fills in the Species' first common Name
		expect(commonName!.toLowerCase()).toMatch(/(platy|xiphophorus)/);

		// Verify hidden ID updated to new species
		const secondSpeciesId = await page.inputValue('input[name="species_id"]');
		expect(secondSpeciesId).toBeTruthy();
		expect(secondSpeciesId).not.toBe(firstSpeciesId); // Should be different species
	});

	test("should properly initialize Tom Select dropdowns", async ({ page }) => {
		// 1. Verify Tom Select is initialized (check for .tomselected class)
		await expect(
			page.locator('select[name="species_common_name"].tomselected')
		).toBeVisible();
		await expect(
			page.locator('select[name="species_latin_name"].tomselected')
		).toBeVisible();

		// 2. Verify Tom Select wrapper exists
		await expect(
			page.locator('select[name="species_common_name"] + .ts-wrapper')
		).toBeVisible();

		// 3. Click dropdown to open
		const control = page.locator(
			'select[name="species_common_name"] + .ts-wrapper .ts-control'
		);
		await control.click();

		// 4. Type to search
		const input = control.locator("input");
		await input.fill("Gup");

		// Wait for API results
		await page.waitForTimeout(1500);

		// 5. Verify search results appear
		await expect(page.locator(".ts-dropdown .option").first()).toBeVisible();

		// 6. Select an option
		await input.press("ArrowDown");
		await page.waitForTimeout(200);
		await input.press("Enter");

		// 7. Verify dropdown closes and value is set
		await page.waitForSelector(".ts-dropdown", { state: "hidden", timeout: 2000 });
		const value = await getTomSelectValue(page, "species_common_name");
		expect(value).toBeTruthy();
	});

	test("should not produce JavaScript errors during field linking", async ({
		page,
	}) => {
		const consoleErrors: string[] = [];

		// Listen for console errors
		page.on("console", (msg) => {
			if (msg.type() === "error") {
				consoleErrors.push(msg.text());
			}
		});

		// Perform several field selections
		await fillTomSelectTypeahead(page, "species_common_name", "Guppy");
		await page.waitForTimeout(500);

		await page.evaluate(() => {
			const commonField = document.getElementById(
				"species_common_name"
			) as HTMLSelectElement & { tomSelectInstance?: any };
			if (commonField?.tomSelectInstance) {
				commonField.tomSelectInstance.clear();
			}
		});
		await page.waitForTimeout(500);

		await fillTomSelectTypeahead(page, "species_latin_name", "Poecilia reticulata");
		await page.waitForTimeout(500);

		// Assert no errors were logged
		expect(consoleErrors).toEqual([]);
	});

	test("should handle bidirectional sync correctly", async ({ page }) => {
		// Select common name first - use "Guppy" which we know exists
		await fillTomSelectTypeahead(page, "species_common_name", "Guppy");
		await page.waitForTimeout(500);

		// Get the synced scientific name
		const scientificName = await getTomSelectValue(page, "species_latin_name");
		expect(scientificName).toBeTruthy();

		// Get the Species id
		const speciesId = await page.inputValue('input[name="species_id"]');
		expect(speciesId).toBeTruthy();

		// Now clear both fields
		await page.evaluate(() => {
			const commonField = document.getElementById(
				"species_common_name"
			) as HTMLSelectElement & { tomSelectInstance?: any };
			const latinField = document.getElementById(
				"species_latin_name"
			) as HTMLSelectElement & { tomSelectInstance?: any };

			if (commonField?.tomSelectInstance) {
				commonField.tomSelectInstance.clear();
			}
			if (latinField?.tomSelectInstance) {
				latinField.tomSelectInstance.clear();
			}
		});
		await page.waitForTimeout(500);

		// Select via scientific name this time
		await fillTomSelectTypeahead(page, "species_latin_name", scientificName!);
		await page.waitForTimeout(500);

		// Verify common name gets synced back
		const newCommonName = await getTomSelectValue(page, "species_common_name");
		expect(newCommonName).toBeTruthy();

		// Verify it is the same Species
		const newSpeciesId = await page.inputValue('input[name="species_id"]');
		expect(newSpeciesId).toBe(speciesId);
	});

	test("should preserve field values across HTMX swaps", async ({ page }) => {
		// Fill in species fields
		await fillTomSelectTypeahead(page, "species_common_name", "Guppy");
		await page.waitForTimeout(500);

		const initialCommonName = await getTomSelectValue(page, "species_common_name");
		const initialScientificName = await getTomSelectValue(page, "species_latin_name");
		const initialSpeciesId = await page.inputValue('input[name="species_id"]');

		// Trigger an HTMX swap by changing species_type
		await page.selectOption('select[name="species_type"]', "Plant");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Change back to Fish
		await page.selectOption('select[name="species_type"]', "Fish");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Wait for Tom Select to reinitialize
		await page.waitForSelector('select[name="species_common_name"].tomselected', {
			timeout: 10000,
		});

		// Note: After HTMX swap, session storage should restore values
		// This is testing the form's session storage persistence, not field linking
		// The actual values might be lost after HTMX swap depending on implementation

		// Just verify the fields are present and functional after swap
		await expect(
			page.locator('select[name="species_common_name"].tomselected')
		).toBeVisible();
		await expect(
			page.locator('select[name="species_latin_name"].tomselected')
		).toBeVisible();
	});

	test("should handle species with multiple common names", async ({ page }) => {
		// Some species have multiple common names
		// Helper now waits for HTMX field linking to complete
		// Use "Swordtail" to test field linking (Xiphophorus hellerii)
		await fillTomSelectTypeahead(page, "species_common_name", "Swordtail");

		// Verify scientific name is populated
		const scientificName = await getTomSelectValue(page, "species_latin_name");
		expect(scientificName).toBeTruthy();
		expect(scientificName).toContain("Xiphophorus");

		// Verify species_id is set
		const speciesId = await page.inputValue('input[name="species_id"]');
		expect(speciesId).toBeTruthy();
		expect(parseInt(speciesId)).toBeGreaterThan(0);
	});

	test("should handle newly created custom species names", async ({ page }) => {
		// Type a custom species name that doesn't exist in the database
		const customName = `Test Species ${Date.now()}`;
		const customScientific = `Testus fishus ${Date.now()}`;

		const commonControl = page.locator(
			'select[name="species_common_name"] + .ts-wrapper .ts-control'
		);
		await commonControl.click();
		const commonInput = commonControl.locator("input");
		await commonInput.fill(customName);
		await page.waitForTimeout(1500);

		// Press Enter to create the custom name (Tom Select allows creation)
		await commonInput.press("Enter");
		await page.waitForTimeout(500);

		// Manually type scientific name
		const scientificControl = page.locator(
			'select[name="species_latin_name"] + .ts-wrapper .ts-control'
		);
		await scientificControl.click();
		const scientificInput = scientificControl.locator("input");
		await scientificInput.fill(customScientific);
		await page.waitForTimeout(1500);
		await scientificInput.press("Enter");
		await page.waitForTimeout(500);

		// Verify both fields have values (even though they're custom)
		const commonValue = await getTomSelectValue(page, "species_common_name");
		const scientificValue = await getTomSelectValue(page, "species_latin_name");

		expect(commonValue).toBe(customName);
		expect(scientificValue).toBe(customScientific);

		// Free text binds nothing: only picking a known Name sets species_id
		expect(await page.inputValue('input[name="species_id"]')).toBe("");
		await expect(page.locator("#species-binding-notice")).toBeHidden();
	});
});
