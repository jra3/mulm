import { test, expect } from "@playwright/test";
import { login } from "./helpers/auth";
import { TEST_USER, TEST_ADMIN, cleanupTestUserSubmissions, getTestDatabase, ensureTestUserExists } from "./helpers/testData";
import { fillTomSelectTypeahead } from "./helpers/tomSelect";

/**
 * Admin Workflow Tests
 *
 * Tests for admin-only actions on submissions:
 * - Request changes (preserves witness data)
 * - Approve/deny submissions
 * - Witness confirmation/decline
 *
 * Related to Issue #169: Changes-requested workflow (0% coverage)
 */

test.describe.configure({ mode: 'serial' });

test.describe("Admin - Changes Requested Workflow", () => {
	test.beforeEach(async () => {
		// Clean up test user submissions before each test
		await cleanupTestUserSubmissions(TEST_USER.email);

		// Ensure admin user exists with password authentication
		await ensureTestUserExists(TEST_ADMIN.email, TEST_ADMIN.password, TEST_ADMIN.displayName, true);
	});

	test("admin can request changes from submitted form", async ({ page }) => {
		// Step 1: Create and submit a form as regular user
		await login(page, TEST_USER);

		// Create a simple submitted form
		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		await page.selectOption('select[name="water_type"]', "Fresh");
		await page.selectOption('select[name="species_type"]', "Fish");
		await page.waitForLoadState("networkidle");

		await page.selectOption('select[name="species_class"]', "Livebearers");

		// Wait for Tom Select to initialize on species name fields (triggered by htmx:load event)
		await page.waitForTimeout(3000);

		const today = new Date().toISOString().split("T")[0];
		await page.fill('input[name="reproduction_date"]', today);

		// Fill species names using Tom Select typeahead
		await fillTomSelectTypeahead(page, "species_common_name", "Guppy");
		await fillTomSelectTypeahead(page, "species_latin_name", "Poecilia reticulata");
		await page.fill('input[name="temperature"]', "75");
		await page.fill('input[name="ph"]', "7.0");
		await page.fill('input[name="gh"]', "150");
		await page.fill('input[name="count"]', "20");

		// Wait for Tom Select and fill foods/spawn
		await page.waitForTimeout(3000);
		await page.selectOption('select[name="foods"]', ["Live"]);
		await page.selectOption('select[name="spawn_locations"]', ["Plant"]);

		// Fill required tank fields
		await page.fill('input[name="tank_size"]', "10 gallon");
		await page.fill('input[name="filter_type"]', "Sponge");
		await page.fill('input[name="water_change_volume"]', "25%");
		await page.fill('input[name="water_change_frequency"]', "Weekly");
		await page.fill('input[name="substrate_type"]', "Gravel");
		await page.fill('input[name="substrate_depth"]', "1 inch");
		await page.fill('input[name="substrate_color"]', "Natural");

		// Submit (not draft)
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForTimeout(500);

		const submitButton = page.locator('button[type="submit"]:has-text("Submit")');
		await submitButton.scrollIntoViewIfNeeded();
		await submitButton.click();

		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Get submission ID from URL
		const submissionUrl = page.url();
		const submissionIdMatch = submissionUrl.match(/submissions\/(\d+)/);
		expect(submissionIdMatch).toBeTruthy();
		const submissionId = parseInt(submissionIdMatch![1]);

		// Logout regular user
		await page.click('button[hx-post="/auth/logout"]');
		await page.waitForLoadState("networkidle");

		// Step 2: Set witness data (admin user already created in beforeEach)
		const db = await getTestDatabase();
		try {
			// Get admin user ID
			const adminUser = await db.get<{ id: number }>(
				"SELECT id FROM members WHERE contact_email = ?",
				TEST_ADMIN.email
			);

			if (!adminUser) {
				throw new Error("Admin user should exist from beforeEach");
			}

			// Simulate witness confirmation
			await db.run(
				"UPDATE submissions SET witnessed_by = ?, witnessed_on = ?, witness_verification_status = ? WHERE id = ?",
				adminUser.id,
				new Date().toISOString(),
				"confirmed",
				submissionId
			);
		} finally {
			await db.close();
		}

		// Login as admin
		await login(page, TEST_ADMIN);

		// Navigate to submission
		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		// Step 3: Request changes
		// Look for the "Request Changes" button in admin panel
		await page.click('button:has-text("Request Changes")');

		// Fill in the reason
		await page.waitForSelector('textarea[name="changes_requested_reason"]');
		await page.fill('textarea[name="changes_requested_reason"]', "Please add more photos and details about water parameters");

		// Submit changes request
		await page.click('button[type="submit"]:has-text("Send Request")');
		await page.waitForLoadState("networkidle");

		// Step 4: Verify in database
		const db2 = await getTestDatabase();
		try {
			const submission = await db2.get(
				"SELECT * FROM submissions WHERE id = ?",
				submissionId
			);

			// Verify changes_requested fields are set
			expect(submission.changes_requested_on).toBeTruthy();
			expect(submission.changes_requested_by).toBeTruthy();
			expect(submission.changes_requested_reason).toBe("Please add more photos and details about water parameters");

			// CRITICAL: Verify witness data is preserved
			expect(submission.witnessed_by).toBeTruthy();
			expect(submission.witnessed_on).toBeTruthy();
			expect(submission.witness_verification_status).toBe("confirmed");

			// Verify status
			expect(submission.submitted_on).toBeTruthy(); // Still submitted
			expect(submission.approved_on).toBeNull(); // Not approved
		} finally {
			await db2.close();
		}
	});

	test("member can edit submission when changes are requested", async ({ page }) => {
		// Step 1: Create and submit a form as regular user
		await login(page, TEST_USER);

		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		await page.selectOption('select[name="water_type"]', "Fresh");
		await page.selectOption('select[name="species_type"]', "Fish");
		await page.waitForLoadState("networkidle");

		await page.selectOption('select[name="species_class"]', "Livebearers");

		// Wait for Tom Select to initialize on species name fields (triggered by htmx:load event)
		await page.waitForTimeout(3000);

		const today = new Date().toISOString().split("T")[0];
		await page.fill('input[name="reproduction_date"]', today);

		// Fill species names using Tom Select typeahead
		await fillTomSelectTypeahead(page, "species_common_name", "Guppy");
		await fillTomSelectTypeahead(page, "species_latin_name", "Poecilia reticulata");
		await page.fill('input[name="temperature"]', "75");
		await page.fill('input[name="ph"]', "7.0");
		await page.fill('input[name="gh"]', "150");
		await page.fill('input[name="count"]', "20");

		// Wait for Tom Select and fill foods/spawn
		await page.waitForTimeout(3000);
		await page.selectOption('select[name="foods"]', ["Live"]);
		await page.selectOption('select[name="spawn_locations"]', ["Plant"]);

		// Fill required tank fields
		await page.fill('input[name="tank_size"]', "10 gallon");
		await page.fill('input[name="filter_type"]', "Sponge");
		await page.fill('input[name="water_change_volume"]', "25%");
		await page.fill('input[name="water_change_frequency"]', "Weekly");
		await page.fill('input[name="substrate_type"]', "Gravel");
		await page.fill('input[name="substrate_depth"]', "1 inch");
		await page.fill('input[name="substrate_color"]', "Natural");

		// Submit (not draft)
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForTimeout(500);

		const submitButton = page.locator('button[type="submit"]:has-text("Submit")');
		await submitButton.scrollIntoViewIfNeeded();
		await submitButton.click();

		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Get submission ID from URL
		const submissionUrl = page.url();
		const submissionIdMatch = submissionUrl.match(/submissions\/(\d+)/);
		expect(submissionIdMatch).toBeTruthy();
		const submissionId = parseInt(submissionIdMatch![1]);

		// Logout regular user
		await page.click('button[hx-post="/auth/logout"]');
		await page.waitForLoadState("networkidle");

		// Step 2: Set witness data
		const db = await getTestDatabase();
		try {
			// Get admin user ID
			const adminUser = await db.get<{ id: number }>(
				"SELECT id FROM members WHERE contact_email = ?",
				TEST_ADMIN.email
			);

			if (!adminUser) {
				throw new Error("Admin user should exist from beforeEach");
			}

			// Simulate witness confirmation
			await db.run(
				"UPDATE submissions SET witnessed_by = ?, witnessed_on = ?, witness_verification_status = ? WHERE id = ?",
				adminUser.id,
				new Date().toISOString(),
				"confirmed",
				submissionId
			);
		} finally {
			await db.close();
		}

		// Login as admin
		await login(page, TEST_ADMIN);

		// Navigate to submission and request changes
		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		await page.click('button:has-text("Request Changes")');
		await page.waitForSelector('textarea[name="changes_requested_reason"]');
		await page.fill('textarea[name="changes_requested_reason"]', "Please add more details");

		await page.click('button[type="submit"]:has-text("Send Request")');
		await page.waitForLoadState("networkidle");

		// Logout admin
		await page.click('button[hx-post="/auth/logout"]');
		await page.waitForLoadState("networkidle");

		// Step 3: Login as member and edit submission
		await login(page, TEST_USER);

		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("#bapForm");

		// Verify member can see the changes requested notice
		const changesNotice = await page.locator('text=/changes.*requested/i').first();
		expect(await changesNotice.isVisible()).toBe(true);

		// Make edits - temperature first to avoid HTMX swap
		await page.fill('input[name="temperature"]', "78");
		await page.waitForTimeout(500);

		// Fill additional details
		await page.fill('input[name="ph"]', "7.2");
		await page.fill('input[name="gh"]', "180");

		// Scroll to ensure button is in view
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForTimeout(500);

		// Save edits (for submitted forms with changes requested, button should be "Save Edits")
		const saveButton = page.locator('button[type="submit"]:has-text("Save Edits")');
		await saveButton.scrollIntoViewIfNeeded();
		await saveButton.click();

		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Step 4: Verify changes persisted but changes_requested fields still set
		const db2 = await getTestDatabase();
		try {
			const submission = await db2.get(
				"SELECT * FROM submissions WHERE id = ?",
				submissionId
			);

			// Verify edits persisted
			expect(submission.temperature).toBe("78");
			expect(submission.ph).toBe("7.2");
			expect(submission.gh).toBe("180");

			// Verify changes_requested fields still set (not cleared yet)
			expect(submission.changes_requested_on).toBeTruthy();
			expect(submission.changes_requested_by).toBeTruthy();
			expect(submission.changes_requested_reason).toBe("Please add more details");

			// Verify witness data still preserved
			expect(submission.witnessed_by).toBeTruthy();
			expect(submission.witnessed_on).toBeTruthy();
			expect(submission.witness_verification_status).toBe("confirmed");
		} finally {
			await db2.close();
		}
	});

	test("resubmitting clears changes_requested fields", async ({ page }) => {
		// Step 1: Create and submit a form as regular user
		await login(page, TEST_USER);

		await page.goto("/submissions/new");
		await page.waitForSelector("#bapForm");

		await page.selectOption('select[name="water_type"]', "Fresh");
		await page.selectOption('select[name="species_type"]', "Fish");
		await page.waitForLoadState("networkidle");

		await page.selectOption('select[name="species_class"]', "Livebearers");

		// Wait for Tom Select to initialize on species name fields (triggered by htmx:load event)
		await page.waitForTimeout(3000);

		const today = new Date().toISOString().split("T")[0];
		await page.fill('input[name="reproduction_date"]', today);

		// Fill species names using Tom Select typeahead
		await fillTomSelectTypeahead(page, "species_common_name", "Guppy");
		await fillTomSelectTypeahead(page, "species_latin_name", "Poecilia reticulata");
		await page.fill('input[name="temperature"]', "75");
		await page.fill('input[name="ph"]', "7.0");
		await page.fill('input[name="gh"]', "150");
		await page.fill('input[name="count"]', "20");

		// Wait for Tom Select and fill foods/spawn
		await page.waitForTimeout(3000);
		await page.selectOption('select[name="foods"]', ["Live"]);
		await page.selectOption('select[name="spawn_locations"]', ["Plant"]);

		// Fill required tank fields
		await page.fill('input[name="tank_size"]', "10 gallon");
		await page.fill('input[name="filter_type"]', "Sponge");
		await page.fill('input[name="water_change_volume"]', "25%");
		await page.fill('input[name="water_change_frequency"]', "Weekly");
		await page.fill('input[name="substrate_type"]', "Gravel");
		await page.fill('input[name="substrate_depth"]', "1 inch");
		await page.fill('input[name="substrate_color"]', "Natural");

		// Submit (not draft)
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForTimeout(500);

		const submitButton = page.locator('button[type="submit"]:has-text("Submit")');
		await submitButton.scrollIntoViewIfNeeded();
		await submitButton.click();

		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Get submission ID from URL
		const submissionUrl = page.url();
		const submissionIdMatch = submissionUrl.match(/submissions\/(\d+)/);
		expect(submissionIdMatch).toBeTruthy();
		const submissionId = parseInt(submissionIdMatch![1]);

		// Logout regular user
		await page.click('button[hx-post="/auth/logout"]');
		await page.waitForLoadState("networkidle");

		// Step 2: Set witness data
		const db = await getTestDatabase();
		try {
			// Get admin user ID
			const adminUser = await db.get<{ id: number }>(
				"SELECT id FROM members WHERE contact_email = ?",
				TEST_ADMIN.email
			);

			if (!adminUser) {
				throw new Error("Admin user should exist from beforeEach");
			}

			// Simulate witness confirmation
			await db.run(
				"UPDATE submissions SET witnessed_by = ?, witnessed_on = ?, witness_verification_status = ? WHERE id = ?",
				adminUser.id,
				new Date().toISOString(),
				"confirmed",
				submissionId
			);
		} finally {
			await db.close();
		}

		// Login as admin
		await login(page, TEST_ADMIN);

		// Navigate to submission and request changes
		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		await page.click('button:has-text("Request Changes")');
		await page.waitForSelector('textarea[name="changes_requested_reason"]');
		await page.fill('textarea[name="changes_requested_reason"]', "Please add more details");

		await page.click('button[type="submit"]:has-text("Send Request")');
		await page.waitForLoadState("networkidle");

		// Verify changes_requested fields are set
		const db2 = await getTestDatabase();
		try {
			const beforeResubmit = await db2.get(
				"SELECT * FROM submissions WHERE id = ?",
				submissionId
			);
			expect(beforeResubmit.changes_requested_on).toBeTruthy();
			expect(beforeResubmit.changes_requested_by).toBeTruthy();
			expect(beforeResubmit.changes_requested_reason).toBe("Please add more details");
		} finally {
			await db2.close();
		}

		// Logout admin
		await page.click('button[hx-post="/auth/logout"]');
		await page.waitForLoadState("networkidle");

		// Step 3: Login as member and resubmit
		await login(page, TEST_USER);

		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("#bapForm");

		// Make some edits
		await page.fill('input[name="ph"]', "7.4");
		await page.waitForTimeout(500);

		// Scroll to ensure button is in view
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForTimeout(500);

		// Look for "Resubmit" button (this should clear changes_requested fields)
		const resubmitButton = page.locator('button[type="submit"]:has-text("Resubmit")');
		await resubmitButton.scrollIntoViewIfNeeded();
		await resubmitButton.click();

		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1000);

		// Step 4: Verify changes_requested fields are cleared
		const db3 = await getTestDatabase();
		try {
			const submission = await db3.get(
				"SELECT * FROM submissions WHERE id = ?",
				submissionId
			);

			// Verify changes_requested fields are cleared
			expect(submission.changes_requested_on).toBeNull();
			expect(submission.changes_requested_by).toBeNull();
			expect(submission.changes_requested_reason).toBeNull();

			// Verify submission is still submitted
			expect(submission.submitted_on).toBeTruthy();

			// Verify witness data still preserved
			expect(submission.witnessed_by).toBeTruthy();
			expect(submission.witnessed_on).toBeTruthy();
			expect(submission.witness_verification_status).toBe("confirmed");

			// Verify edits persisted
			expect(submission.ph).toBe("7.4");
		} finally {
			await db3.close();
		}
	});
});
