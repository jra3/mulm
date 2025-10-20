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

	// Wait for the dropdown to appear with options
	await page.waitForSelector('.ts-dropdown .option', {
		state: "visible",
		timeout: 5000,
	});

	if (exactMatch) {
		// Find the exact match in the dropdown
		await page.click(`.ts-dropdown .option:has-text("${searchText}")`);
	} else {
		// Click the first option
		await page.click('.ts-dropdown .option:first-child');
	}

	// Wait for Tom Select to process the selection and close dropdown
	await page.waitForSelector('.ts-dropdown', { state: "hidden", timeout: 2000 });
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
