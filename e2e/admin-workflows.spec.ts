import { test, expect } from "@playwright/test";
import { login, logout } from "./helpers/auth";
import { TEST_USER, TEST_ADMIN, cleanupTestUserSubmissions, getTestDatabase, ensureTestUserExists } from "./helpers/testData";
import { fillTomSelectTypeahead } from "./helpers/tomSelect";
import { createTestSubmission } from "./helpers/submissions";

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
		// Step 1: Create a submitted form directly in database (faster and more reliable)
		const db = await getTestDatabase();
		let submissionId: number;
		let adminId: number;

		try {
			// Get user and admin IDs
			const user = await db.get<{ id: number }>(
				"SELECT id FROM members WHERE contact_email = ?",
				TEST_USER.email
			);
			const admin = await db.get<{ id: number }>(
				"SELECT id FROM members WHERE contact_email = ?",
				TEST_ADMIN.email
			);

			if (!user || !admin) {
				throw new Error("Test users not found in database");
			}

			adminId = admin.id;

			// Create submitted submission with witness confirmation
			// Set witnessed date to 70 days ago to ensure waiting period is satisfied
			submissionId = await createTestSubmission({
				memberId: user.id,
				submitted: true,
				witnessed: true,
				witnessedBy: admin.id,
				witnessedDaysAgo: 70,
			});
		} finally {
			await db.close();
		}

		// Step 2: Login as admin and request changes
		await login(page, TEST_ADMIN);

		// Navigate to submission
		await page.goto(`/submissions/${submissionId}`);
		await page.waitForLoadState("networkidle");

		// Scroll down to approval panel at the bottom where Request Changes button is
		const requestChangesButton = page.locator('button:has-text("Request Changes")').first();
		await requestChangesButton.scrollIntoViewIfNeeded();
		await requestChangesButton.click();

		// Wait for HTMX dialog to appear with the textarea field
		await page.waitForSelector('textarea[name="content"]', { timeout: 10000 });
		await page.fill('textarea[name="content"]', "Please add more photos and details about water parameters");

		// Submit changes request
		await page.click('button[type="submit"]:has-text("Send")');

		// Wait for HTMX redirect to complete (redirects to /admin/queue/{program})
		await page.waitForURL(/\/admin\/queue\//, { timeout: 10000 });
		await page.waitForLoadState("networkidle");

		// Step 3: Verify in database
		const db3 = await getTestDatabase();
		try {
			const submission = await db3.get(
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
			await db3.close();
		}
	});

	// NOTE: Works in CI (serial mode). May have race conditions in local parallel mode.
	test("member can edit submission when changes are requested", async ({ page }) => {
		// Step 1: Create a submitted submission with witness confirmation
		const db = await getTestDatabase();
		let submissionId: number;
		try {
			const user = await db.get<{ id: number }>(
				"SELECT id FROM members WHERE contact_email = ?",
				TEST_USER.email
			);
			const admin = await db.get<{ id: number }>(
				"SELECT id FROM members WHERE contact_email = ?",
				TEST_ADMIN.email
			);

			if (!user || !admin) {
				throw new Error("Test users not found in database");
			}

			// Create submission with witness confirmation (recently witnessed, still in waiting period)
			submissionId = await createTestSubmission({
				memberId: user.id,
				submitted: true,
				witnessed: true,
				witnessedBy: admin.id,
				witnessedDaysAgo: 0, // Just witnessed today - still in waiting period
			});
		} finally {
			await db.close();
		}

		// Login as admin
		await login(page, TEST_ADMIN);

		// Navigate to submission and request changes
		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		await page.click('button:has-text("Request Changes")');
		await page.waitForSelector('textarea[name="content"]', { timeout: 10000 });
		await page.fill('textarea[name="content"]', "Please add more details");

		await page.click('button[type="submit"]:has-text("Send")');

		// Wait for HTMX redirect to complete
		await page.waitForURL(/\/admin\/queue\//, { timeout: 10000 });
		await page.waitForLoadState("networkidle");

		// Logout admin
		await logout(page);

		// Step 3: Login as member and edit submission
		await login(page, TEST_USER);

		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("#bapForm");

		// Verify changes requested banner is visible
		const changesNotice = page.locator('text=Changes Requested');
		await expect(changesNotice).toBeVisible();

		// Verify admin feedback is shown
		const feedback = page.locator('text=Please add more details');
		await expect(feedback).toBeVisible();

		// Make edits - temperature first to avoid HTMX swap
		await page.fill('input[name="temperature"]', "78");

		// Fill additional details
		await page.fill('input[name="ph"]', "7.2");
		await page.fill('input[name="gh"]', "180");

		// Save edits as draft (for changes-requested submissions, Save Draft keeps changes_requested fields)
		const saveDraftButton = page.locator('button[type="submit"]:has-text("Save Draft")');
		await saveDraftButton.scrollIntoViewIfNeeded();
		await saveDraftButton.click();

		await page.waitForLoadState("networkidle");

		// Step 4: Verify changes persisted but changes_requested fields still set
		const dbTest2c = await getTestDatabase();
		try {
			const submission = await dbTest2c.get(
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
			await dbTest2c.close();
		}
	});

	// NOTE: Works in CI (serial mode). May have race conditions in local parallel mode.
	test("resubmitting clears changes_requested fields", async ({ page }) => {
		// Step 1: Create a submitted submission with witness confirmation and changes requested
		const db = await getTestDatabase();
		let submissionId: number;
		try {
			const user = await db.get<{ id: number }>(
				"SELECT id FROM members WHERE contact_email = ?",
				TEST_USER.email
			);
			const admin = await db.get<{ id: number }>(
				"SELECT id FROM members WHERE contact_email = ?",
				TEST_ADMIN.email
			);

			if (!user || !admin) {
				throw new Error("Test users not found in database");
			}

			// Create submission with witness confirmation
			submissionId = await createTestSubmission({
				memberId: user.id,
				submitted: true,
				witnessed: true,
				witnessedBy: admin.id,
				witnessedDaysAgo: 0, // Just witnessed today - still in waiting period
			});

			// Set changes_requested fields directly in database
			await db.run(
				"UPDATE submissions SET changes_requested_on = ?, changes_requested_by = ?, changes_requested_reason = ? WHERE id = ?",
				new Date().toISOString(),
				admin.id,
				"Please add more details",
				submissionId
			);
		} finally {
			await db.close();
		}

		// Step 2: Login as member and resubmit
		await login(page, TEST_USER);

		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("#bapForm");

		// Verify changes requested banner is visible
		await expect(page.locator('text=Changes Requested')).toBeVisible();

		// Make some edits
		await page.fill('input[name="ph"]', "7.4");

		// Click "Resubmit" button (this should clear changes_requested fields)
		const resubmitButton = page.locator('button[type="submit"]:has-text("Resubmit")');
		await resubmitButton.scrollIntoViewIfNeeded();
		await resubmitButton.click();

		// Wait for redirect after resubmit
		await page.waitForURL(/\/submissions\/\d+/, { timeout: 10000 });
		await page.waitForLoadState("networkidle");

		// Step 3: Verify changes_requested fields are cleared
		const db2 = await getTestDatabase();
		try {
			const submission = await db2.get(
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
			await db2.close();
		}
	});
});
