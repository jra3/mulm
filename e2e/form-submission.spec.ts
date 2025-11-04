import { test, expect } from "@playwright/test";
import { login, logout } from "./helpers/auth";
import { TEST_USER, cleanupTestUserSubmissions, getSubmissionsForMember, getTestDatabase } from "./helpers/testData";
import { fillTomSelectTypeahead, selectTomSelectMultiple, clearTomSelect } from "./helpers/tomSelect";

test.describe.configure({ mode: 'serial' });

test.describe("Form Submission Flow", () => {
	// Clean up before each test
	test.beforeEach(async () => {
		await cleanupTestUserSubmissions(TEST_USER.email);
	});

	test("should create and save a draft submission", async ({ page }) => {
		// Login
		await login(page);

		// Navigate to new submission form
		await page.goto("/submissions/new");

		// Wait for form to load
		await page.waitForSelector("#bapForm");

		// Fill in basic fields
		await page.selectOption('select[name="water_type"]', "Fresh");
		await page.selectOption('select[name="species_type"]', "Fish");

		// Wait for HTMX swap to complete (species_type triggers full form replacement)
		await page.waitForLoadState("networkidle");
		await page.waitForSelector('select[name="species_class"]', { state: "visible" });

		// Select species class
		await page.selectOption('select[name="species_class"]', "Livebearers");

		// Fill in reproduction date
		const today = new Date().toISOString().split("T")[0];
		await page.fill('input[name="reproduction_date"]', today);

		// Fill in species common name using Tom Select typeahead
		await fillTomSelectTypeahead(page, "species_common_name", "Guppy");
		await fillTomSelectTypeahead(page, "species_latin_name", "Poecilia reticulata");

		// Fill in tank details
		await page.fill('input[name="temperature"]', "75");
		await page.fill('input[name="ph"]', "7.2");
		await page.fill('input[name="gh"]', "150");

		// Fill in fry count (for fish)
		await page.fill('input[name="count"]', "25");

		// Scroll to bottom to ensure button is in view
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForTimeout(500);

		// Save as draft
		const currentUrl = page.url();
		const draftButton = page.locator('button[name="draft"]');
		await draftButton.scrollIntoViewIfNeeded();
		await draftButton.click();

		// Wait for HTMX to process and form to reload/redirect
		await page.waitForLoadState("networkidle");

		// Give extra time for HTMX swap to complete
		await page.waitForTimeout(1000);

		// Check if URL changed (successful save redirects to /submissions/:id)
		const newUrl = page.url();
		console.log(`URL before save: ${currentUrl}`);
		console.log(`URL after save: ${newUrl}`);

		// Verify the submission was created in the database
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
			// Tom Select ArrowDown selects first result (may vary)
			expect(submissions[0].species_common_name).toContain("Guppy");
			expect(submissions[0].species_latin_name).toBeTruthy();
			expect(submissions[0].temperature).toBe("75");
		} finally {
			await db.close();
		}
	});

	test("should submit a complete form for review", async ({ page }) => {
		// Login
		await login(page);

		// Navigate to new submission form
		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		// Fill in all required fields
		await page.selectOption('select[name="water_type"]', "Fresh");
		await page.selectOption('select[name="species_type"]', "Fish");

		// Wait for HTMX swap to complete
		await page.waitForLoadState("networkidle");
		await page.waitForSelector('select[name="species_class"]', { state: "visible" });

		await page.selectOption('select[name="species_class"]', "Livebearers");

		// Wait for Tom Select JavaScript to initialize on foods/spawn_locations
		// Give it plenty of time since it's triggered by htmx:load event
		await page.waitForTimeout(3000);

		const today = new Date().toISOString().split("T")[0];
		await page.fill('input[name="reproduction_date"]', today);

		await fillTomSelectTypeahead(page, "species_common_name", "Fancy Guppy");
		await fillTomSelectTypeahead(page, "species_latin_name", "Poecilia reticulata");

		// Fill required fields for Fish (foods and spawn_locations)
		// Use direct selectOption with actual values from source arrays
		await page.selectOption('select[name="foods"]', ["Live", "Flake"]);
		await page.selectOption('select[name="spawn_locations"]', ["Plant"]);

		// Tank details (all required fields)
		await page.fill('input[name="tank_size"]', "20 gallon");
		await page.fill('input[name="filter_type"]', "Sponge filter");
		await page.fill('input[name="water_change_volume"]', "25%");
		await page.fill('input[name="water_change_frequency"]', "Weekly");
		await page.fill('input[name="temperature"]', "76");
		await page.fill('input[name="ph"]', "7.4");
		await page.fill('input[name="gh"]', "180");
		await page.fill('input[name="substrate_type"]', "Gravel");
		await page.fill('input[name="substrate_depth"]', "2 inches");
		await page.fill('input[name="substrate_color"]', "Natural");

		// Fry count
		await page.fill('input[name="count"]', "30");

		// Scroll to ensure submit button is in view
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForTimeout(500);

		// Submit (not draft)
		const submitButton = page.locator('button[type="submit"]:has-text("Submit")');
		await submitButton.scrollIntoViewIfNeeded();
		await submitButton.click();

		// Wait for submission to complete
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

			// Verify submitted_on is set
			expect(submission.submitted_on).toBeTruthy();

			// Verify witness status is pending
			expect(submission.witness_verification_status).toBe("pending");

			// Verify data is correct (Tom Select may select different first result)
			expect(submission.species_common_name).toBeTruthy();
			expect(submission.temperature).toBe("76");
		} finally {
			await db.close();
		}
	});

	test("should allow editing a draft submission", async ({ page }) => {
		// Login
		await login(page);

		// Create a draft first
		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		await page.selectOption('select[name="water_type"]', "Fresh");
		await page.selectOption('select[name="species_type"]', "Fish");

		// Wait for HTMX swap to complete
		await page.waitForLoadState("networkidle");
		await page.waitForSelector('select[name="species_class"]', { state: "visible" });

		await page.selectOption('select[name="species_class"]', "Livebearers");

		const today = new Date().toISOString().split("T")[0];
		await page.fill('input[name="reproduction_date"]', today);
		await fillTomSelectTypeahead(page, "species_common_name", "Original Guppy");
		await fillTomSelectTypeahead(page, "species_latin_name", "Poecilia reticulata");
		await page.fill('input[name="temperature"]', "74");
		await page.fill('input[name="ph"]', "7.0");
		await page.fill('input[name="gh"]', "150");
		await page.fill('input[name="count"]', "20");

		// Scroll to ensure button is in view
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForTimeout(500);

		// Save draft
		const draftButton = page.locator('button[name="draft"]');
		await draftButton.scrollIntoViewIfNeeded();
		await draftButton.click();
		await page.waitForLoadState("networkidle");

		// After saving draft, should redirect to /me (which redirects to /member/{id})
		await page.waitForTimeout(2000);
		expect(page.url()).toMatch(/\/member\/\d+/);

		// Find the draft submission in the member page - it should be the first row with "Draft" status
		// The draft status badge (📝) is a link to the submission
		const draftLink = page.locator('a[href^="/submissions/"]:has-text("📝")').first();
		const href = await draftLink.getAttribute("href");
		expect(href).toBeTruthy();

		// Extract submission ID from href
		const submissionIdMatch = href!.match(/\/submissions\/(\d+)/);
		expect(submissionIdMatch).toBeTruthy();
		const submissionId = submissionIdMatch![1];
		console.log(`Found draft submission ID: ${submissionId}`);

		// Edit the draft
		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("#bapForm");

		// Change some fields - change temperature FIRST to avoid HTMX swaps resetting it
		await page.fill('input[name="temperature"]', "78");

		// Wait a bit before changing species name (which might trigger swaps)
		await page.waitForTimeout(500);

		// Clear the existing Tom Select value first, then fill with new value
		await clearTomSelect(page, "species_common_name");
		await page.waitForTimeout(300);
		await fillTomSelectTypeahead(page, "species_common_name", "Updated Guppy");

		// Wait for any HTMX swaps from species name change to complete
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Scroll to ensure button is in view
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForTimeout(500);

		// Save edits - for drafts, use "Save Draft" button (not "Save Edits")
		const saveButton = page.locator('button[name="draft"]');
		await saveButton.scrollIntoViewIfNeeded();
		await saveButton.click();
		await page.waitForLoadState("networkidle");

		// Give HTMX time to process the save
		await page.waitForTimeout(2000);

		// Verify changes in database
		const db = await getTestDatabase();
		try {
			const submission = await db.get(
				"SELECT * FROM submissions WHERE id = ?",
				parseInt(submissionId)
			);

			// Tom Select may select different first results
			expect(submission.species_common_name).toBeTruthy();
			expect(submission.temperature).toBe("78");
			// Should still be a draft
			expect(submission.submitted_on).toBeNull();
		} finally {
			await db.close();
		}
	});

	test("should delete a draft submission", async ({ page }) => {
		// Login
		await login(page);

		// Create a draft
		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		await page.selectOption('select[name="water_type"]', "Fresh");
		await page.selectOption('select[name="species_type"]', "Fish");

		// Wait for HTMX swap to complete
		await page.waitForLoadState("networkidle");
		await page.waitForSelector('select[name="species_class"]', { state: "visible" });

		await page.selectOption('select[name="species_class"]', "Livebearers");

		const today = new Date().toISOString().split("T")[0];
		await page.fill('input[name="reproduction_date"]', today);
		await fillTomSelectTypeahead(page, "species_common_name", "To Delete");
		await fillTomSelectTypeahead(page, "species_latin_name", "Deletis fishus");
		await page.fill('input[name="temperature"]', "75");
		await page.fill('input[name="ph"]', "7.0");
		await page.fill('input[name="gh"]', "150");
		await page.fill('input[name="count"]', "10");

		// Scroll to ensure button is in view
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForTimeout(500);

		// Save draft
		const draftButton = page.locator('button[name="draft"]');
		await draftButton.scrollIntoViewIfNeeded();
		await draftButton.click();
		await page.waitForLoadState("networkidle");

		// After saving draft, should redirect to /me (which redirects to /member/{id})
		await page.waitForTimeout(2000);
		expect(page.url()).toMatch(/\/member\/\d+/);

		// Find the draft submission in the member page by the draft badge
		const draftLink = page.locator('a[href^="/submissions/"]:has-text("📝")').first();
		const href = await draftLink.getAttribute("href");
		expect(href).toBeTruthy();

		// Extract submission ID from href
		const submissionIdMatch = href!.match(/\/submissions\/(\d+)/);
		expect(submissionIdMatch).toBeTruthy();
		const submissionId = parseInt(submissionIdMatch![1]);
		console.log(`Found draft submission ID to delete: ${submissionId}`);

		// Listen for confirm dialog and accept it
		page.on("dialog", (dialog) => dialog.accept());

		// Delete the draft
		await page.click('button:has-text("Delete Draft")');

		// Wait for redirect
		await page.waitForLoadState("networkidle");

		// Verify deletion in database
		const db = await getTestDatabase();
		try {
			const submission = await db.get("SELECT * FROM submissions WHERE id = ?", submissionId);
			expect(submission).toBeUndefined();
		} finally {
			await db.close();
		}
	});
});
