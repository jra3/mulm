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
	console.log(`[TomSelect] START: field=${fieldName}, search="${searchText}"`);

	// Tom Select wraps the original select and creates a ts-wrapper sibling
	// Structure: <select class="tomselected"> + <div class="ts-wrapper"><div class="ts-control"><input></div></div>

	// Wait for Tom Select to be initialized on this field
	// Tom Select adds the "tomselected" class and creates the ts-wrapper sibling
	await page.waitForSelector(`select[name="${fieldName}"].tomselected`, { timeout: 10000 });
	console.log(`[TomSelect] Tom Select initialized`);

	// Get the Tom Select wrapper for this specific field (to avoid matching other dropdowns)
	const tsWrapper = page.locator(`select[name="${fieldName}"] + .ts-wrapper`);
	await tsWrapper.waitFor({ timeout: 2000 });
	console.log(`[TomSelect] Found ts-wrapper`);

	// Find the ts-control which is inside the ts-wrapper
	const control = tsWrapper.locator('.ts-control');

	// Click to focus/open the dropdown
	await control.click();
	console.log(`[TomSelect] Clicked control to open dropdown`);

	// Type into the Tom Select input
	const input = control.locator('input');
	await input.fill(searchText);
	console.log(`[TomSelect] Filled input with: "${searchText}"`);

	// Wait for the API call to complete (Tom Select hits /api/species/search)
	// This replaces the arbitrary 1500ms wait
	const responsePromise = page.waitForResponse(
		(resp) => resp.url().includes('/api/species/search') && resp.status() === 200,
		{ timeout: 5000 }
	);
	const response = await responsePromise;
	console.log(`[TomSelect] API responded: ${response.status()}`);

	// Log the response body to see what options we got
	const responseBody = await response.json();
	console.log(`[TomSelect] API returned ${responseBody.length} results`);
	if (responseBody.length > 0) {
		console.log(`[TomSelect] First result: ${JSON.stringify(responseBody[0])}`);
	}

	// Small delay to let Tom Select process the API response and render options
	// This is more reliable than trying to wait for specific DOM changes in CI
	await page.waitForTimeout(500);

	// Log dropdown state and contents
	const dropdown = tsWrapper.locator('.ts-dropdown');
	const isDropdownVisible = await dropdown.isVisible().catch(() => false);
	console.log(`[TomSelect] Dropdown visible: ${isDropdownVisible}`);

	if (isDropdownVisible) {
		const dropdownHTML = await dropdown.innerHTML().catch(() => 'ERROR getting HTML');
		console.log(`[TomSelect] Dropdown HTML length: ${dropdownHTML.length} chars`);
		const optionCount = await dropdown.locator('.option').count();
		console.log(`[TomSelect] Option count: ${optionCount}`);
	}

	// Use keyboard navigation to select the first option
	// This is actually more reliable than clicking in some cases
	await input.press('ArrowDown');
	console.log(`[TomSelect] Pressed ArrowDown`);
	await page.waitForTimeout(100);
	await input.press('Enter');
	console.log(`[TomSelect] Pressed Enter`);

	// Wait for the dropdown to close, indicating Tom Select has processed the selection
	// Use the field-specific dropdown, not the generic selector
	await dropdown.waitFor({ state: "hidden", timeout: 5000 });
	console.log(`[TomSelect] Dropdown closed`);

	// Wait for the underlying select value to be set
	const selectElement = page.locator(`select[name="${fieldName}"]`);
	await selectElement.evaluate((el: HTMLSelectElement) => {
		// Poll until value is set
		return new Promise<void>((resolve) => {
			const checkValue = () => {
				if (el.value && el.value.trim() !== '') {
					resolve();
				} else {
					setTimeout(checkValue, 50);
				}
			};
			// Start checking immediately
			checkValue();
			// But also set a timeout
			setTimeout(() => resolve(), 3000);
		});
	});

	const finalValue = await selectElement.inputValue();
	console.log(`[TomSelect] Final select value: "${finalValue}"`);

	// If this is a species field and HTMX field linking is enabled, wait for it to complete
	if (waitForFieldLinking && (fieldName === 'species_latin_name' || fieldName === 'species_common_name')) {
		console.log(`[TomSelect] Waiting for HTMX field linking...`);
		// Wait for network to be idle (HTMX request to populate linked field)
		// Use a shorter timeout than full networkidle
		try {
			await page.waitForLoadState('networkidle', { timeout: 3000 });
			console.log(`[TomSelect] Network idle - field linking complete`);
		} catch (e) {
			console.log(`[TomSelect] Network idle timeout (may be OK)`);
			// If networkidle times out, that's okay - the critical part (value set) already happened
			// This just ensures we wait for any HTMX field linking that might be happening
		}

		// Log the linked field value to see if HTMX worked
		const linkedField = fieldName === 'species_latin_name' ? 'species_common_name' : 'species_latin_name';
		const linkedValue = await page.locator(`select[name="${linkedField}"]`).inputValue().catch(() => 'ERROR');
		console.log(`[TomSelect] Linked field ${linkedField} value: "${linkedValue}"`);
	}

	console.log(`[TomSelect] COMPLETE: field=${fieldName}`);
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
