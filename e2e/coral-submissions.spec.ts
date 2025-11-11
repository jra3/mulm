import { test, expect } from "@playwright/test";
import { login } from "./helpers/auth";
import { TEST_USER, cleanupTestUserSubmissions, getTestDatabase } from "./helpers/testData";
import { fillTomSelectTypeahead } from "./helpers/tomSelect";
import { attachDebugger } from "./helpers/debugger";

test.describe.configure({ mode: 'serial' });

test.describe("Coral Submissions", () => {
	test.beforeEach(async () => {
		await cleanupTestUserSubmissions(TEST_USER.email);
	});

	test("should show Coral-specific fields (foods, lighting) and hide Fish/Plant fields", async ({ page }) => {
		await login(page);
		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		// Select Coral species type
		await page.selectOption('select[name="water_type"]', "Salt");
		await page.selectOption('select[name="species_type"]', "Coral");

		// Wait for HTMX to swap the form
		await page.waitForLoadState("networkidle");
		await page.waitForSelector('select[name="species_class"]', { state: "visible" });

		// Give HTMX extra time to complete the swap
		await page.waitForTimeout(1000);

		// Coral-specific fields should be visible
		await expect(page.locator('select[name="foods"]')).toBeVisible();
		await expect(page.locator('input[name="light_type"]')).toBeVisible();
		await expect(page.locator('input[name="light_strength"]')).toBeVisible();
		await expect(page.locator('input[name="light_hours"]')).toBeVisible();
		await expect(page.locator('select[name="co2"]')).toBeVisible();
		await expect(page.locator('input[name="propagation_method"]')).toBeVisible(); // Corals have propagation methods too!

		// Fish-specific fields should NOT be visible
		await expect(page.locator('input[name="count"]')).not.toBeVisible();
		await expect(page.locator('select[name="spawn_locations"]')).not.toBeVisible();
	});

	test("should show 'Date Propagated' label instead of 'Date Spawned'", async ({ page }) => {
		await login(page);
		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		await page.selectOption('select[name="species_type"]', "Coral");
		await page.waitForLoadState("networkidle");

		// Check for "Propagated" text in the label
		const dateLabelText = await page.textContent('label[for="reproduction_date"]');
		expect(dateLabelText).toContain("Propagated");
		expect(dateLabelText).not.toContain("Spawned");
	});

	test("should allow saving a draft with partial Coral data", async ({ page }) => {
		// Listen for console messages
		page.on('console', msg => console.log('PAGE LOG:', msg.text()));
		page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

		await login(page);
		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		// Fill minimal fields for draft
		await page.selectOption('select[name="water_type"]', "Salt");
		await page.selectOption('select[name="species_type"]', "Coral");
		await page.waitForLoadState("networkidle");
		await page.waitForSelector('select[name="species_class"]', { state: "visible" });

		await page.selectOption('select[name="species_class"]', "Hard");

		// Wait for Tom Select JavaScript to initialize on species name fields
		// Give it plenty of time since it's triggered by htmx:load event
		await page.waitForTimeout(3000);

		const today = new Date().toISOString().split("T")[0];
		await page.fill('input[name="reproduction_date"]', today);

		await fillTomSelectTypeahead(page, "species_common_name", "Small Polyp");
		await fillTomSelectTypeahead(page, "species_latin_name", "Acropora millepora");

		// Don't fill foods or lighting fields - partial draft

		// Scroll and save draft
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForTimeout(500);

		// Check for any validation errors before submitting
		const errors = await page.locator('.error-message, [aria-invalid="true"]').count();
		console.log(`Found ${errors} validation errors before draft save`);

		const draftButton = page.locator('button[name="draft"]');
		await draftButton.scrollIntoViewIfNeeded();
		await draftButton.click();
		await page.waitForLoadState("networkidle");

		// After saving draft, should redirect to /me (which redirects to /member/{id})
		await page.waitForTimeout(2000);

		const currentUrl = page.url();
		console.log(`URL after draft save: ${currentUrl}`);

		// Check if there are any error messages on the page
		const pageErrors = await page.locator('.error-message').allTextContents();
		if (pageErrors.length > 0) {
			console.log(`Errors on page: ${pageErrors.join(', ')}`);
		}

		expect(currentUrl).toMatch(/\/member\/\d+/);

		// Verify draft was saved
		const db = await getTestDatabase();
		try {
			const user = await db.get<{ id: number }>(
				"SELECT id FROM members WHERE contact_email = ?",
				TEST_USER.email
			);
			expect(user).toBeTruthy();

			const submissions = await db.all(
				"SELECT * FROM submissions WHERE member_id = ? AND submitted_on IS NULL",
				user!.id
			);

			expect(submissions.length).toBeGreaterThan(0);
			expect(submissions[0].species_type).toBe("Coral");
			expect(submissions[0].species_class).toBe("Hard");
		} finally {
			await db.close();
		}
	});

	test("should require foods for Coral submission", async ({ page }) => {
		await login(page);
		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		// Fill all required fields EXCEPT foods
		await page.selectOption('select[name="water_type"]', "Salt");
		await page.selectOption('select[name="species_type"]', "Coral");
		await page.waitForLoadState("networkidle");
		await page.waitForSelector('select[name="species_class"]', { state: "visible" });

		await page.selectOption('select[name="species_class"]', "Hard");

		// Wait for Tom Select JavaScript to initialize on species name fields
		// Give it plenty of time since it's triggered by htmx:load event
		await page.waitForTimeout(3000);

		const today = new Date().toISOString().split("T")[0];
		await page.fill('input[name="reproduction_date"]', today);

		await fillTomSelectTypeahead(page, "species_common_name", "Small Polyp");
		await fillTomSelectTypeahead(page, "species_latin_name", "Acropora millepora");

		// Fill lighting fields
		await page.fill('input[name="light_type"]', "T5");
		await page.fill('input[name="light_strength"]', "400W");
		await page.fill('input[name="light_hours"]', "12");

		// Fill tank details
		await page.fill('input[name="tank_size"]', "50 gallon");
		await page.fill('input[name="filter_type"]', "Sump");
		await page.fill('input[name="water_change_volume"]', "20%");
		await page.fill('input[name="water_change_frequency"]', "Bi-weekly");
		await page.fill('input[name="temperature"]', "78");
		await page.fill('input[name="ph"]', "8.2");
		await page.fill('input[name="gh"]', "N/A");
		await page.fill('input[name="specific_gravity"]', "1.025");
		await page.fill('input[name="substrate_type"]', "Sand");
		await page.fill('input[name="substrate_depth"]', "1 inch");
		await page.fill('input[name="substrate_color"]', "White");

		// Leave foods empty - should fail validation

		// Scroll and try to submit
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForTimeout(500);

		const submitButton = page.locator('button[type="submit"]:has-text("Submit")');
		await submitButton.scrollIntoViewIfNeeded();
		await submitButton.click();
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Should still be on the form (not submitted)
		expect(page.url()).toContain("/submissions/");

		// Verify NOT submitted in database
		const db = await getTestDatabase();
		try {
			const user = await db.get<{ id: number }>(
				"SELECT id FROM members WHERE contact_email = ?",
				TEST_USER.email
			);
			expect(user).toBeTruthy();

			const submissions = await db.all(
				"SELECT * FROM submissions WHERE member_id = ? AND submitted_on IS NOT NULL",
				user!.id
			);

			// Should be 0 submitted submissions (validation failed)
			expect(submissions.length).toBe(0);
		} finally {
			await db.close();
		}
	});

	test("should require all lighting fields for Coral submission", async ({ page }) => {
		await login(page);
		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		// Fill all required fields EXCEPT one lighting field
		await page.selectOption('select[name="water_type"]', "Salt");
		await page.selectOption('select[name="species_type"]', "Coral");
		await page.waitForLoadState("networkidle");
		await page.waitForSelector('select[name="species_class"]', { state: "visible" });

		await page.selectOption('select[name="species_class"]', "Hard");

		// Wait for Tom Select JavaScript to initialize on species name fields
		// Give it plenty of time since it's triggered by htmx:load event
		await page.waitForTimeout(3000);

		const today = new Date().toISOString().split("T")[0];
		await page.fill('input[name="reproduction_date"]', today);

		await fillTomSelectTypeahead(page, "species_common_name", "Small Polyp");
		await fillTomSelectTypeahead(page, "species_latin_name", "Acropora millepora");

		// Fill foods
		await page.selectOption('select[name="foods"]', ["Live"]);

		// Fill only 2 of 3 lighting fields - missing light_type
		await page.fill('input[name="light_strength"]', "400W");
		await page.fill('input[name="light_hours"]', "12");
		// Leave light_type empty

		// Fill tank details
		await page.fill('input[name="tank_size"]', "50 gallon");
		await page.fill('input[name="filter_type"]', "Sump");
		await page.fill('input[name="water_change_volume"]', "20%");
		await page.fill('input[name="water_change_frequency"]', "Bi-weekly");
		await page.fill('input[name="temperature"]', "78");
		await page.fill('input[name="ph"]', "8.2");
		await page.fill('input[name="gh"]', "N/A");
		await page.fill('input[name="specific_gravity"]', "1.025");
		await page.fill('input[name="substrate_type"]', "Sand");
		await page.fill('input[name="substrate_depth"]', "1 inch");
		await page.fill('input[name="substrate_color"]', "White");

		// Try to submit
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForTimeout(500);

		const submitButton = page.locator('button[type="submit"]:has-text("Submit")');
		await submitButton.scrollIntoViewIfNeeded();
		await submitButton.click();
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Should still be on the form (not submitted)
		expect(page.url()).toContain("/submissions/");

		// Verify NOT submitted in database
		const db = await getTestDatabase();
		try {
			const user = await db.get<{ id: number }>(
				"SELECT id FROM members WHERE contact_email = ?",
				TEST_USER.email
			);
			expect(user).toBeTruthy();

			const submissions = await db.all(
				"SELECT * FROM submissions WHERE member_id = ? AND submitted_on IS NOT NULL",
				user!.id
			);

			// Should be 0 submitted submissions (validation failed)
			expect(submissions.length).toBe(0);
		} finally {
			await db.close();
		}
	});

	test("should require CO2 description when CO2=yes", async ({ page }) => {
		await login(page);
		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		await page.selectOption('select[name="water_type"]', "Salt");
		await page.selectOption('select[name="species_type"]', "Coral");
		await page.waitForLoadState("networkidle");
		await page.waitForSelector('select[name="species_class"]', { state: "visible" });

		await page.selectOption('select[name="species_class"]', "Hard");

		// Wait for Tom Select JavaScript to initialize on species name fields
		// Give it plenty of time since it's triggered by htmx:load event
		await page.waitForTimeout(3000);

		const today = new Date().toISOString().split("T")[0];
		await page.fill('input[name="reproduction_date"]', today);

		await fillTomSelectTypeahead(page, "species_common_name", "Small Polyp");
		await fillTomSelectTypeahead(page, "species_latin_name", "Acropora millepora");

		await page.selectOption('select[name="foods"]', ["Live"]);
		await page.fill('input[name="light_type"]', "T5");
		await page.fill('input[name="light_strength"]', "400W");
		await page.fill('input[name="light_hours"]', "12");

		// Select CO2=yes but don't fill description
		await page.selectOption('select[name="co2"]', "yes");
		await page.waitForTimeout(500); // Wait for conditional field to appear

		// CO2 description field should now be visible
		await expect(page.locator('textarea[name="co2_description"]')).toBeVisible();

		// Leave co2_description empty

		// Fill tank details
		await page.fill('input[name="tank_size"]', "50 gallon");
		await page.fill('input[name="filter_type"]', "Sump");
		await page.fill('input[name="water_change_volume"]', "20%");
		await page.fill('input[name="water_change_frequency"]', "Bi-weekly");
		await page.fill('input[name="temperature"]', "78");
		await page.fill('input[name="ph"]', "8.2");
		await page.fill('input[name="gh"]', "N/A");
		await page.fill('input[name="specific_gravity"]', "1.025");
		await page.fill('input[name="substrate_type"]', "Sand");
		await page.fill('input[name="substrate_depth"]', "1 inch");
		await page.fill('input[name="substrate_color"]', "White");

		// Try to submit - should fail
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForTimeout(500);

		const submitButton = page.locator('button[type="submit"]:has-text("Submit")');
		await submitButton.scrollIntoViewIfNeeded();
		await submitButton.click();
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Should still be on the form
		expect(page.url()).toContain("/submissions/");

		// Verify NOT submitted
		const db = await getTestDatabase();
		try {
			const user = await db.get<{ id: number }>(
				"SELECT id FROM members WHERE contact_email = ?",
				TEST_USER.email
			);
			expect(user).toBeTruthy();

			const submissions = await db.all(
				"SELECT * FROM submissions WHERE member_id = ? AND submitted_on IS NOT NULL",
				user!.id
			);

			expect(submissions.length).toBe(0);
		} finally {
			await db.close();
		}
	});

	test("should successfully submit complete Coral form", async ({ page }) => {
		await login(page);
		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		// Fill all required fields
		await page.selectOption('select[name="water_type"]', "Salt");
		await page.selectOption('select[name="species_type"]', "Coral");
		await page.waitForLoadState("networkidle");
		await page.waitForSelector('select[name="species_class"]', { state: "visible" });

		await page.selectOption('select[name="species_class"]', "Hard");

		// Wait for Tom Select JavaScript to initialize on species name fields
		// Give it plenty of time since it's triggered by htmx:load event
		await page.waitForTimeout(3000);

		const today = new Date().toISOString().split("T")[0];
		await page.fill('input[name="reproduction_date"]', today);

		await fillTomSelectTypeahead(page, "species_common_name", "Small Polyp");
		await fillTomSelectTypeahead(page, "species_latin_name", "Acropora millepora");

		// Fill Coral-specific required fields
		await page.selectOption('select[name="foods"]', ["Live"]);
		await page.fill('input[name="light_type"]', "T5");
		await page.fill('input[name="light_strength"]', "400W");
		await page.fill('input[name="light_hours"]', "12");

		// Fill tank details
		await page.fill('input[name="tank_size"]', "50 gallon");
		await page.fill('input[name="filter_type"]', "Sump");
		await page.fill('input[name="water_change_volume"]', "20%");
		await page.fill('input[name="water_change_frequency"]', "Bi-weekly");
		await page.fill('input[name="temperature"]', "78");
		await page.fill('input[name="ph"]', "8.2");
		await page.fill('input[name="gh"]', "N/A");
		await page.fill('input[name="specific_gravity"]', "1.025");
		await page.fill('input[name="substrate_type"]', "Sand");
		await page.fill('input[name="substrate_depth"]', "1 inch");
		await page.fill('input[name="substrate_color"]', "White");

		// Submit
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForTimeout(500);

		const submitButton = page.locator('button[type="submit"]:has-text("Submit")');
		await submitButton.scrollIntoViewIfNeeded();
		await submitButton.click();
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Verify submission in database
		const db = await getTestDatabase();
		try {
			const user = await db.get<{ id: number }>(
				"SELECT id FROM members WHERE contact_email = ?",
				TEST_USER.email
			);
			expect(user).toBeTruthy();

			const submissions = await db.all(
				"SELECT * FROM submissions WHERE member_id = ? AND submitted_on IS NOT NULL",
				user!.id
			);

			expect(submissions.length).toBeGreaterThan(0);
			const submission = submissions[0];

			// Verify it's a Coral submission
			expect(submission.species_type).toBe("Coral");
			expect(submission.program).toBe("coral");
			expect(submission.water_type).toBe("Salt");
			expect(submission.light_type).toBe("T5");
			expect(submission.light_strength).toBe("400W");
			expect(submission.light_hours).toBe("12");
			expect(submission.submitted_on).toBeTruthy();
			expect(submission.witness_verification_status).toBe("pending");

			// Verify Fish/Plant fields are null/empty
			expect(submission.count).toBeNull();
			expect(submission.propagation_method).toBeNull();
		} finally {
			await db.close();
		}
	});

	test("should allow adding supplement rows dynamically", async ({ page }) => {
		await login(page);
		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		await page.selectOption('select[name="species_type"]', "Coral");
		await page.waitForLoadState("networkidle");

		// Wait for the supplements section to be visible
		await page.waitForSelector('#supplementsContainer', { state: "visible" });

		// Check initial state - should have at least one row
		const initialRows = await page.locator('input[name="supplement_type[]"]').count();
		expect(initialRows).toBeGreaterThanOrEqual(1);

		// Click "Add +" button to add more rows
		const addButton = page.locator('button:has-text("Add +")');
		await addButton.click();
		await page.waitForTimeout(300);

		// Should now have more rows
		const afterAddRows = await page.locator('input[name="supplement_type[]"]').count();
		expect(afterAddRows).toBe(initialRows + 1);
	});
});
