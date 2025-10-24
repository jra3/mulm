import { Page } from "@playwright/test";

/**
 * Tom Select interaction helpers
 * Tom Select creates custom dropdowns that require special handling
 */

/**
 * Fill a Tom Select typeahead field by typing and selecting
 *
 * @param page - Playwright page object
 * @param fieldName - The name attribute of the select element (e.g., "species_common_name")
 * @param searchText - Text to type/search for
 * @param exactMatch - Whether to select exact match or first result (default: first result)
 */
export async function fillTomSelectTypeahead(
	page: Page,
	fieldName: string,
	searchText: string,
	exactMatch = false
): Promise<void> {
	// Tom Select wraps the original select and creates a ts-wrapper sibling
	// Structure: <select class="tomselected"> + <div class="ts-wrapper"><div class="ts-control"><input></div></div>

	// Wait for Tom Select to be initialized on this field
	// Tom Select adds the "tomselected" class and creates the ts-wrapper sibling
	await page.waitForSelector(`select[name="${fieldName}"].tomselected`, { timeout: 10000 });

	// Also wait for the ts-wrapper to be created
	await page.waitForSelector(`select[name="${fieldName}"] + .ts-wrapper`, { timeout: 2000 });

	// Find the ts-control which is inside the ts-wrapper
	const control = page.locator(`select[name="${fieldName}"] + .ts-wrapper .ts-control`);

	// Click to focus/open the dropdown
	await control.click();

	// Type into the Tom Select input
	const input = control.locator('input');
	await input.fill(searchText);

	// Wait for API results to load (Tom Select hits /api/species/search)
	await page.waitForTimeout(1500);

	// Use keyboard navigation to select the first option
	// This is more reliable than trying to find and click dropdown elements
	// ArrowDown will highlight the first result, Enter will select it
	await input.press('ArrowDown');
	await page.waitForTimeout(200);
	await input.press('Enter');

	// Delay to let Tom Select process the Enter key and update the value
	// Without this, the dropdown might close before the value is actually set
	// 500ms is required for CI environments (300ms was too short)
	await page.waitForTimeout(500);

	// Wait for Tom Select to process the selection and close dropdown
	// Use a specific selector for the dropdown associated with this field to avoid race conditions
	const tsWrapper = page.locator(`select[name="${fieldName}"] + .ts-wrapper`);
	const dropdownSelector = tsWrapper.locator('.ts-dropdown');

	try {
		// Increased timeout from 2s to 5s for CI environments
		await dropdownSelector.waitFor({ state: "hidden", timeout: 5000 });
	} catch (err) {
		// If dropdown doesn't close within timeout, it's likely already closed
		// or there's a timing issue - log but don't fail the test
		console.warn(`Tom Select dropdown for "${fieldName}" did not hide within timeout (this may be normal)`);
	}
}

/**
 * Select a value from a regular Tom Select dropdown (not typeahead)
 *
 * @param page - Playwright page object
 * @param fieldName - The name attribute of the select element
 * @param value - The value or text to select
 */
export async function selectTomSelectOption(page: Page, fieldName: string, value: string): Promise<void> {
	// Find the Tom Select control
	const control = page.locator(`select[name="${fieldName}"]`).locator('..').locator('.ts-control');

	// Click to open dropdown
	await control.click();

	// Wait for dropdown
	await page.waitForSelector('.ts-dropdown .ts-dropdown-content .option', {
		state: "visible",
	});

	// Click the option with the matching text or value
	await page.click(`.ts-dropdown .option:has-text("${value}"), .ts-dropdown .option[data-value="${value}"]`);

	await page.waitForTimeout(200);
}

/**
 * Select multiple values from a Tom Select multi-select dropdown
 *
 * @param page - Playwright page object
 * @param fieldName - The name attribute of the select element
 * @param values - Array of values to select
 */
export async function selectTomSelectMultiple(page: Page, fieldName: string, values: string[]): Promise<void> {
	// Wait for Tom Select to be initialized
	await page.waitForSelector(`select[name="${fieldName}"].tomselected`, { timeout: 5000 });

	// Find the ts-control
	const control = page.locator(`select[name="${fieldName}"] + .ts-wrapper .ts-control`);

	for (const value of values) {
		// Click to open dropdown
		await control.click();

		// Wait longer for dropdown to fully open/render
		await page.waitForTimeout(800);

		// Verify dropdown is actually open before clicking
		const dropdownVisible = await page.locator('.ts-dropdown .option').first().isVisible();
		if (!dropdownVisible) {
			// Dropdown didn't open, try clicking control again
			await control.click();
			await page.waitForTimeout(500);
		}

		// Click the option directly
		await page.click(`.ts-dropdown .option:has-text("${value}")`, { force: true });

		// Wait for selection to process
		await page.waitForTimeout(300);
	}
}

/**
 * Get the currently selected value from a Tom Select field
 *
 * @param page - Playwright page object
 * @param fieldName - The name attribute of the select element
 * @returns The selected value
 */
export async function getTomSelectValue(page: Page, fieldName: string): Promise<string | null> {
	// Get the value from the underlying select element
	return await page.locator(`select[name="${fieldName}"]`).inputValue();
}

/**
 * Clear a Tom Select field
 *
 * @param page - Playwright page object
 * @param fieldName - The name attribute of the select element
 */
export async function clearTomSelect(page: Page, fieldName: string): Promise<void> {
	// Find the clear button in the Tom Select control
	const clearButton = page.locator(`select[name="${fieldName}"]`).locator('..').locator('.ts-control .clear');

	if (await clearButton.isVisible()) {
		await clearButton.click();
		await page.waitForTimeout(200);
	}
}
