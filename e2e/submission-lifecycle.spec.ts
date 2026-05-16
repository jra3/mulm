import { test, expect } from "@playwright/test";
import { login, logout } from "./helpers/auth";
import { TEST_USER, TEST_ADMIN, cleanupTestUserSubmissions, getTestDatabase, ensureTestUserExists } from "./helpers/testData";
import { createTestSubmission } from "./helpers/submissions";
import { fillTomSelectTypeahead } from "./helpers/tomSelect";

/**
 * Submission Lifecycle Tests
 *
 * End-to-end tests that verify complete submission journeys from draft to final state.
 * Tests all major paths through the state machine including happy path, changes requested,
 * witness decline, and post-approval edits.
 *
 * Related to Issue #171: Add end-to-end submission lifecycle tests
 */

test.describe.configure({ mode: 'serial' });

test.describe("Submission Complete Lifecycle", () => {
	test.beforeEach(async () => {
		// Clean up test user submissions before each test
		await cleanupTestUserSubmissions(TEST_USER.email);

		// Ensure test users exist with password authentication
		await ensureTestUserExists(TEST_USER.email, TEST_USER.password, TEST_USER.displayName, false);
		await ensureTestUserExists(TEST_ADMIN.email, TEST_ADMIN.password, TEST_ADMIN.displayName, true);
	});

	test("happy path: draft → submit → witness → wait → bring to meeting → approve", async ({ page }) => {
		// Step 1: Create a witnessed submission directly (witnessed 70 days ago to satisfy waiting period).
		// final_submission_on is intentionally null so we can exercise the
		// "Brought to Meeting" click as a real step in the flow.
		const db = await getTestDatabase();
		let submissionId: number;
		let memberId: number;
		let adminId: number;

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

			memberId = user.id;
			adminId = admin.id;

			// Create submission with witness confirmation set to 70 days ago
			// This simulates the complete flow but skips the waiting period
			submissionId = await createTestSubmission({
				memberId: user.id,
				submitted: true,
				witnessed: true,
				witnessedBy: admin.id,
				witnessedDaysAgo: 70, // 70 days ago - well past the 60-day requirement
			});
		} finally {
			await db.close();
		}

		// Step 2: Member confirms they brought the fish to a meeting.
		// Without this, the submission stays in awaiting-final-submission and
		// admins can't see it in the approval queue.
		await login(page, TEST_USER);

		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		const broughtToMeetingButton = page.locator('button:has-text("Confirm: Brought to Meeting")');
		await broughtToMeetingButton.scrollIntoViewIfNeeded();
		await broughtToMeetingButton.click();
		await page.waitForLoadState("networkidle");

		// Verify final_submission_on was set
		const dbAfterFinalSubmit = await getTestDatabase();
		try {
			const submission = await dbAfterFinalSubmit.get(
				"SELECT final_submission_on FROM submissions WHERE id = ?",
				submissionId
			);
			expect(submission.final_submission_on).toBeTruthy();
		} finally {
			await dbAfterFinalSubmit.close();
		}

		await logout(page);

		// Step 3: Login as admin and approve the submission
		await login(page, TEST_ADMIN);

		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		// Wait for approval panel to load
		const approveButton = page.locator('button:has-text("Approve")').first();
		await approveButton.scrollIntoViewIfNeeded();

		// Wait for the approval form to fully load
		await page.waitForLoadState("networkidle");

		// Select species using Tom Select typeahead (required field)
		await fillTomSelectTypeahead(page, "group_id", "Poecilia reticulata");

		// Wait for HTMX to update the points dropdown based on selected species
		await page.waitForTimeout(500);

		// Select base points from dropdown
		await page.selectOption('select[name="points"]', "10");

		// Click approve
		await approveButton.click();

		// Wait for redirect to approval queue
		await page.waitForURL(/\/admin\/(witness-queue|queue)\//, { timeout: 10000 });
		await page.waitForLoadState("networkidle");

		// Step 6: Verify final approved state and side effects
		const db4 = await getTestDatabase();
		try {
			const submission = await db4.get("SELECT * FROM submissions WHERE id = ?", submissionId);
			expect(submission.approved_on).toBeTruthy();
			expect(submission.approved_by).toBe(adminId);
			expect(submission.points).toBe(10);
			// Witness data should still be preserved
			expect(submission.witnessed_by).toBe(adminId);
			expect(submission.witnessed_on).toBeTruthy();
			expect(submission.witness_verification_status).toBe("confirmed");

			// Verify activity feed entry was created
			const activityEntry = await db4.get(
				"SELECT * FROM activity_feed WHERE member_id = ? AND activity_type = 'submission_approved'",
				memberId
			);
			expect(activityEntry).toBeTruthy();
		} finally {
			await db4.close();
		}
	});

	test("changes path: draft → submit → witness → wait → changes → edit → resubmit → approve", async ({ page }) => {
		// Step 1: Create a submitted submission with witness confirmation (waiting period satisfied)
		const db = await getTestDatabase();
		let submissionId: number;
		let adminId: number;

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

			adminId = admin.id;

			// Create submission already in the approval queue (witnessed past waiting
			// period and submitter has clicked "Brought to Meeting")
			submissionId = await createTestSubmission({
				memberId: user.id,
				submitted: true,
				witnessed: true,
				witnessedBy: admin.id,
				witnessedDaysAgo: 70,
				finalSubmitted: true,
			});
		} finally {
			await db.close();
		}

		// Step 2: Login as admin and request changes
		await login(page, TEST_ADMIN);

		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		const requestChangesButton = page.locator('button:has-text("Request Changes")');
		await requestChangesButton.scrollIntoViewIfNeeded();
		await requestChangesButton.click();

		await page.waitForSelector('textarea[name="content"]', { timeout: 10000 });
		await page.fill('textarea[name="content"]', "Please add more photos of the fry");

		await page.click('button[type="submit"]:has-text("Send")');

		// Wait for redirect
		await page.waitForURL(/\/admin\/queue\//, { timeout: 10000 });
		await page.waitForLoadState("networkidle");

		// Verify changes_requested state
		const db2 = await getTestDatabase();
		try {
			const submission = await db2.get("SELECT * FROM submissions WHERE id = ?", submissionId);
			expect(submission.changes_requested_on).toBeTruthy();
			expect(submission.changes_requested_by).toBe(adminId);
			expect(submission.changes_requested_reason).toBe("Please add more photos of the fry");
			// Witness data should be preserved
			expect(submission.witnessed_by).toBe(adminId);
			expect(submission.witnessed_on).toBeTruthy();
			expect(submission.witness_verification_status).toBe("confirmed");
		} finally {
			await db2.close();
		}

		// Step 3: Logout admin, login as member, and edit submission
		await logout(page);
		await login(page, TEST_USER);

		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("#bapForm");

		// Verify changes requested banner is visible
		await expect(page.locator('text=Changes Requested')).toBeVisible();
		await expect(page.locator('text=Please add more photos of the fry')).toBeVisible();

		// Make edits
		await page.fill('input[name="count"]', "30");
		await page.fill('input[name="temperature"]', "76");

		// Resubmit
		const resubmitButton = page.locator('button[type="submit"]:has-text("Resubmit")');
		await resubmitButton.scrollIntoViewIfNeeded();
		await resubmitButton.click();

		await page.waitForURL(/\/submissions\/\d+/, { timeout: 10000 });
		await page.waitForLoadState("networkidle");

		// Step 4: Verify changes_requested fields cleared but witness data preserved
		const db3 = await getTestDatabase();
		try {
			const submission = await db3.get("SELECT * FROM submissions WHERE id = ?", submissionId);
			expect(submission.changes_requested_on).toBeNull();
			expect(submission.changes_requested_by).toBeNull();
			expect(submission.changes_requested_reason).toBeNull();
			// Edits should be saved
			expect(submission.count).toBe("30");
			expect(submission.temperature).toBe("76");
			// Witness data should still be preserved
			expect(submission.witnessed_by).toBe(adminId);
			expect(submission.witnessed_on).toBeTruthy();
			expect(submission.witness_verification_status).toBe("confirmed");
		} finally {
			await db3.close();
		}

		// Step 5: Logout member, login as admin, and approve
		await logout(page);
		await login(page, TEST_ADMIN);

		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		// Wait for approval panel to load
		const approveButton = page.locator('button:has-text("Approve")').first();
		await approveButton.scrollIntoViewIfNeeded();

		// Wait for the approval form to fully load
		await page.waitForLoadState("networkidle");

		// Select species using Tom Select typeahead (required field)
		await fillTomSelectTypeahead(page, "group_id", "Poecilia reticulata");
		await page.waitForTimeout(500);

		// Select base points from dropdown
		await page.selectOption('select[name="points"]', "10");

		// Click approve
		await approveButton.click();

		await page.waitForURL(/\/admin\/queue\//, { timeout: 10000 });
		await page.waitForLoadState("networkidle");

		// Step 6: Verify final approved state
		const db4 = await getTestDatabase();
		try {
			const submission = await db4.get("SELECT * FROM submissions WHERE id = ?", submissionId);
			expect(submission.approved_on).toBeTruthy();
			expect(submission.approved_by).toBe(adminId);
			expect(submission.points).toBe(10);
			// Witness data should still be preserved
			expect(submission.witnessed_by).toBe(adminId);
			expect(submission.witnessed_on).toBeTruthy();
		} finally {
			await db4.close();
		}
	});

	test("decline path: draft → submit → witness decline → verify declined state", async ({ page }) => {
		// Step 1: Create a submitted submission (not yet witnessed)
		const db = await getTestDatabase();
		let submissionId: number;
		let adminId: number;

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

			adminId = admin.id;

			// Create submitted submission (pending witness)
			// Set reproduction date to 70 days ago so it's eligible for approval after decline
			submissionId = await createTestSubmission({
				memberId: user.id,
				submitted: true,
				witnessed: false,
				reproductionDaysAgo: 70, // Old enough to be past waiting period
			});
		} finally {
			await db.close();
		}

		// Step 2: Login as admin and decline witness
		await login(page, TEST_ADMIN);

		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		// Click "Request More Info" button (opens a dialog)
		const requestInfoButton = page.locator('button:has-text("Request More Info")');
		await requestInfoButton.scrollIntoViewIfNeeded();
		await requestInfoButton.click();

		// Wait for dialog to appear and fill the reason textarea (required field with minlength=10)
		await page.waitForSelector('form#witnessForm', { timeout: 5000 });
		await page.fill('textarea[name="reason"]', "Additional documentation is needed to verify this submission.");
		await page.click('form#witnessForm button[type="submit"]');

		// Wait for HTMX redirect (goes to witness-queue or approval queue depending on action)
		await page.waitForURL(/\/admin\/(witness-queue|queue)\//, { timeout: 10000 });
		await page.waitForLoadState("networkidle");

		// Verify witness declined state
		// Note: Declining witness does NOT skip the waiting period - submission still needs
		// to be 60 days old (based on reproduction_date) before it can be approved
		const db2 = await getTestDatabase();
		try {
			const submission = await db2.get("SELECT * FROM submissions WHERE id = ?", submissionId);
			expect(submission.witness_verification_status).toBe("declined");
			expect(submission.witnessed_by).toBe(adminId);
			expect(submission.witnessed_on).toBeTruthy();
			expect(submission.approved_on).toBeNull(); // Not yet approved

			// Verify decline reason was stored (in submission_notes table)
			// The actual storage mechanism for decline reasons may vary
		} finally {
			await db2.close();
		}
	});

	test("complex path: witness → changes → resubmit → changes again → approve", async ({ page }) => {
		// Step 1: Create a witnessed submission (waiting period satisfied)
		const db = await getTestDatabase();
		let submissionId: number;
		let adminId: number;

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

			adminId = admin.id;

			// Create submission already in the approval queue (witnessed past
			// waiting period and submitter has clicked "Brought to Meeting")
			submissionId = await createTestSubmission({
				memberId: user.id,
				submitted: true,
				witnessed: true,
				witnessedBy: admin.id,
				witnessedDaysAgo: 70,
				finalSubmitted: true,
			});
		} finally {
			await db.close();
		}

		// Step 2: Admin requests changes (first time)
		await login(page, TEST_ADMIN);

		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		let requestChangesButton = page.locator('button:has-text("Request Changes")');
		await requestChangesButton.scrollIntoViewIfNeeded();
		await requestChangesButton.click();

		await page.waitForSelector('textarea[name="content"]', { timeout: 10000 });
		await page.fill('textarea[name="content"]', "First request: add water parameters");
		await page.click('button[type="submit"]:has-text("Send")');

		await page.waitForURL(/\/admin\/queue\//, { timeout: 10000 });
		await page.waitForLoadState("networkidle");

		// Step 3: Member edits and resubmits
		await logout(page);
		await login(page, TEST_USER);

		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("#bapForm");

		await page.fill('input[name="ph"]', "7.5");

		let resubmitButton = page.locator('button[type="submit"]:has-text("Resubmit")');
		await resubmitButton.scrollIntoViewIfNeeded();
		await resubmitButton.click();

		await page.waitForURL(/\/submissions\/\d+/, { timeout: 10000 });
		await page.waitForLoadState("networkidle");

		// Verify changes_requested cleared after first resubmit
		const db2 = await getTestDatabase();
		try {
			const submission = await db2.get("SELECT * FROM submissions WHERE id = ?", submissionId);
			expect(submission.changes_requested_on).toBeNull();
			expect(submission.ph).toBe("7.5");
		} finally {
			await db2.close();
		}

		// Step 4: Admin requests changes again (second time)
		await logout(page);
		await login(page, TEST_ADMIN);

		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		requestChangesButton = page.locator('button:has-text("Request Changes")');
		await requestChangesButton.scrollIntoViewIfNeeded();
		await requestChangesButton.click();

		await page.waitForSelector('textarea[name="content"]', { timeout: 10000 });
		await page.fill('textarea[name="content"]', "Second request: add substrate details");
		await page.click('button[type="submit"]:has-text("Send")');

		await page.waitForURL(/\/admin\/queue\//, { timeout: 10000 });
		await page.waitForLoadState("networkidle");

		// Step 5: Member edits and resubmits again
		await logout(page);
		await login(page, TEST_USER);

		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("#bapForm");

		await page.fill('input[name="substrate_type"]', "Sand");

		resubmitButton = page.locator('button[type="submit"]:has-text("Resubmit")');
		await resubmitButton.scrollIntoViewIfNeeded();
		await resubmitButton.click();

		await page.waitForURL(/\/submissions\/\d+/, { timeout: 10000 });
		await page.waitForLoadState("networkidle");

		// Step 6: Admin approves
		await logout(page);
		await login(page, TEST_ADMIN);

		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		// Wait for approval panel to load
		const approveButton = page.locator('button:has-text("Approve")').first();
		await approveButton.scrollIntoViewIfNeeded();

		// Wait for the approval form to fully load
		await page.waitForLoadState("networkidle");

		// Select species using Tom Select typeahead (required field)
		await fillTomSelectTypeahead(page, "group_id", "Poecilia reticulata");
		await page.waitForTimeout(500);

		// Select base points from dropdown
		await page.selectOption('select[name="points"]', "10");

		// Click approve
		await approveButton.click();

		await page.waitForURL(/\/admin\/queue\//, { timeout: 10000 });
		await page.waitForLoadState("networkidle");

		// Step 7: Verify final state - witness data preserved through multiple change cycles
		const db3 = await getTestDatabase();
		try {
			const submission = await db3.get("SELECT * FROM submissions WHERE id = ?", submissionId);
			expect(submission.approved_on).toBeTruthy();
			expect(submission.changes_requested_on).toBeNull();
			expect(submission.ph).toBe("7.5");
			expect(submission.substrate_type).toBe("Sand");
			// Witness data should still be preserved
			expect(submission.witnessed_by).toBe(adminId);
			expect(submission.witnessed_on).toBeTruthy();
			expect(submission.witness_verification_status).toBe("confirmed");
		} finally {
			await db3.close();
		}
	});
});

test.describe("Bring-to-Meeting (manual approval queue gating)", () => {
	test.beforeEach(async () => {
		await cleanupTestUserSubmissions(TEST_USER.email);
		await ensureTestUserExists(TEST_USER.email, TEST_USER.password, TEST_USER.displayName, false);
		await ensureTestUserExists(TEST_ADMIN.email, TEST_ADMIN.password, TEST_ADMIN.displayName, true);
	});

	test("witnessed-but-not-final-submitted submissions stay out of the admin queue until the submitter clicks; un-queue removes them again", async ({ page }) => {
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

			// Witnessed past the waiting period but no final_submission_on yet
			submissionId = await createTestSubmission({
				memberId: user.id,
				submitted: true,
				witnessed: true,
				witnessedBy: admin.id,
				witnessedDaysAgo: 70,
				speciesCommonName: "Bring-to-Meeting Test Guppy",
			});
		} finally {
			await db.close();
		}

		// Step 1: Admin queue should NOT contain this submission yet
		await login(page, TEST_ADMIN);
		await page.goto("/admin/queue/fish");
		await page.waitForLoadState("networkidle");

		const queueLinkBefore = page.locator(`a[href="/submissions/${submissionId}"]`);
		await expect(queueLinkBefore).toHaveCount(0);

		await logout(page);

		// Step 2: Submitter sees the "Bring to Meeting" panel and clicks the button
		await login(page, TEST_USER);
		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		await expect(page.locator('h3:has-text("Bring to Meeting")')).toBeVisible();

		const broughtToMeetingButton = page.locator('button:has-text("Confirm: Brought to Meeting")');
		await broughtToMeetingButton.scrollIntoViewIfNeeded();
		await broughtToMeetingButton.click();
		await page.waitForLoadState("networkidle");

		// final_submission_on is set
		const dbAfterFinalSubmit = await getTestDatabase();
		try {
			const submission = await dbAfterFinalSubmit.get(
				"SELECT final_submission_on FROM submissions WHERE id = ?",
				submissionId
			);
			expect(submission.final_submission_on).toBeTruthy();
		} finally {
			await dbAfterFinalSubmit.close();
		}

		await logout(page);

		// Step 3: Admin queue now contains the submission
		await login(page, TEST_ADMIN);
		await page.goto("/admin/queue/fish");
		await page.waitForLoadState("networkidle");

		const queueLinkAfter = page.locator(`a[href="/submissions/${submissionId}"]`);
		await expect(queueLinkAfter).toHaveCount(1);

		await logout(page);

		// Step 4: Submitter un-queues
		await login(page, TEST_USER);
		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		page.on("dialog", (dialog) => dialog.accept());
		const removeFromQueueButton = page.locator('button:has-text("Remove from Queue")');
		await removeFromQueueButton.scrollIntoViewIfNeeded();
		await removeFromQueueButton.click();
		await page.waitForLoadState("networkidle");

		const dbAfterUnqueue = await getTestDatabase();
		try {
			const submission = await dbAfterUnqueue.get(
				"SELECT final_submission_on FROM submissions WHERE id = ?",
				submissionId
			);
			expect(submission.final_submission_on).toBeNull();
		} finally {
			await dbAfterUnqueue.close();
		}

		await logout(page);

		// Step 5: Admin queue is empty again
		await login(page, TEST_ADMIN);
		await page.goto("/admin/queue/fish");
		await page.waitForLoadState("networkidle");

		const queueLinkAfterUnqueue = page.locator(`a[href="/submissions/${submissionId}"]`);
		await expect(queueLinkAfterUnqueue).toHaveCount(0);
	});
});
