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
 * @param waitForFieldLinking - Whether to wait for HTMX field linking to complete (default: true)
 */
export async function fillTomSelectTypeahead(
	page: Page,
	fieldName: string,
	searchText: string,
	exactMatch = false,
	waitForFieldLinking = true
): Promise<void> {
	// Tom Select wraps the original select and creates a ts-wrapper sibling
	// Structure: <select class="tomselected"> + <div class="ts-wrapper"><div class="ts-control"><input></div></div>

	// Wait for Tom Select to be initialized on this field
	await page.waitForSelector(`select[name="${fieldName}"].tomselected`, { timeout: 10000 });

	// Get the Tom Select wrapper for this specific field (to avoid matching other dropdowns)
	const tsWrapper = page.locator(`select[name="${fieldName}"] + .ts-wrapper`);
	await tsWrapper.waitFor({ timeout: 2000 });

	// Find the ts-control and input
	const control = tsWrapper.locator('.ts-control');
	const input = control.locator('input');

	// Open dropdown and type search text
	await control.click();
	await input.fill(searchText);

	// Wait for the API call to complete (instead of arbitrary 1500ms timeout)
	await page.waitForResponse(
		(resp) => resp.url().includes('/api/species/search') && resp.status() === 200,
		{ timeout: 5000 }
	);

	// Small delay for Tom Select to process API response and render options
	await page.waitForTimeout(500);

	// Use keyboard navigation to select the first option
	await input.press('ArrowDown');
	await page.waitForTimeout(100);
	await input.press('Enter');

	// Wait for dropdown to close (use field-specific selector, not generic .ts-dropdown)
	const dropdown = tsWrapper.locator('.ts-dropdown');
	await dropdown.waitFor({ state: "hidden", timeout: 5000 });

	// If this is a species field with HTMX field linking, wait for network to settle
	if (waitForFieldLinking && (fieldName === 'species_latin_name' || fieldName === 'species_common_name')) {
		try {
			await page.waitForLoadState('networkidle', { timeout: 3000 });
		} catch (e) {
			// Timeout is OK - the value is set, this just ensures HTMX linking completes
		}
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
