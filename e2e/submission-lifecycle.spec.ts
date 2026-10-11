import { test, expect, type Page } from "@playwright/test";
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

/**
 * Re-witness a Submission whose Witness a member's save voided (ADR-0001).
 * The caller must be logged in as a committee member who is not the
 * submitter. The reproduction date is past the waiting period, so the confirm
 * puts it straight back in the approval queue; there is no member step.
 *
 * A Witness cannot be confirmed without a Species, and the witness sets the
 * points (ADR-0003). A Submission the member bound by picking a Name opens in
 * the panel as "the member says it's", to be answered Yes; an unbound one is
 * chosen here first, through the panel's search. Then the base points (10)
 * and Confirm.
 */
/**
 * Approve from the queue page, the way a committee member does at a meeting
 * (#527): open the row, tap Approve to arm it, tap again to confirm. The
 * button posts the total the row shows; the lifecycle computes first-time.
 */
async function approveFromQueue(page: Page, submissionId: number): Promise<void> {
	await page.goto("/admin/queue");
	await page.waitForSelector(`#queue-row-${submissionId}`);
	await page.locator(`#queue-row-${submissionId} summary`).click();
	const arm = page.locator(`#queue-approve-${submissionId}`);
	await arm.scrollIntoViewIfNeeded();
	await arm.click();
	const confirm = page.locator(`#queue-confirm-${submissionId}`);
	await expect(confirm).toBeVisible();
	await confirm.click();
	await page.waitForURL(/\/admin\/queue/, { timeout: 10000 });
	await page.waitForLoadState("networkidle");
	await expect(page.locator(`#queue-approved-${submissionId}`)).toBeVisible();
}

async function rewitness(page: Page, submissionId: number): Promise<void> {
	await page.goto(`/submissions/${submissionId}`);
	await page.waitForSelector("#witness-species");

	if ((await page.locator("#witness-bound-species").count()) === 0) {
		await expect(page.locator("#witness-species")).toContainText("The member wrote");
		await expect(page.locator("#witness-confirm")).toBeDisabled();
		await fillTomSelectTypeahead(page, "group_id", "Poecilia reticulata", false, false);
		await page.locator("#witness-species-use").click();
		// Choosing reloads the page with the Species named in the panel
		await expect(page.locator("#witness-bound-species")).toBeVisible({ timeout: 10000 });
	}

	// The member's pick is settled with Yes; the witness's own choice already is
	if ((await page.locator("#witness-species-yes").count()) > 0) {
		await page.locator('label[for="witness-species-yes"], label:has(#witness-species-yes)').first().click();
	}
	await page.locator('label:has(#witness-points-10)').click();

	const witnessButton = page.locator("#witness-confirm");
	await expect(witnessButton).toBeEnabled({ timeout: 10000 });
	await witnessButton.scrollIntoViewIfNeeded();
	await witnessButton.click();
	await page.waitForURL(/\/admin\/witness-queue\//, { timeout: 10000 });
	await page.waitForLoadState("networkidle");

	const db = await getTestDatabase();
	try {
		const submission = await db.get(
			"SELECT witness_verification_status, species_id FROM submissions WHERE id = ?",
			submissionId
		);
		expect(submission.witness_verification_status).toBe("confirmed");
		expect(submission.species_id).toBeTruthy();
	} finally {
		await db.close();
	}
}

test.describe("Submission Complete Lifecycle", () => {
	test.beforeEach(async () => {
		// Clean up test user submissions before each test
		await cleanupTestUserSubmissions(TEST_USER.email);

		// Ensure test users exist with password authentication
		await ensureTestUserExists(TEST_USER.email, TEST_USER.password, TEST_USER.displayName, false);
		await ensureTestUserExists(TEST_ADMIN.email, TEST_ADMIN.password, TEST_ADMIN.displayName, true);
	});

	test("happy path: draft → submit → witness → wait → approve", async ({ page }) => {
		// Step 1: Create a witnessed submission directly (witnessed 70 days ago
		// to satisfy the waiting period). That alone puts it in the approval
		// queue: the member has nothing to click.
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
				bound: true, // the witness bound it; approval requires a Species
			});
		} finally {
			await db.close();
		}

		// Step 2: The member sees that it is time to bring the fry to a meeting,
		// with nothing to click
		await login(page, TEST_USER);

		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		await expect(page.locator('h3:has-text("Bring to Meeting")')).toBeVisible();
		await expect(page.locator('button:has-text("Brought to Meeting")')).toHaveCount(0);

		await logout(page);

		// Step 3: Login as admin and approve the submission at the meeting:
		// one button on the queue page, no form
		await login(page, TEST_ADMIN);
		await approveFromQueue(page, submissionId);

		// Step 6: Verify final approved state and side effects
		const db4 = await getTestDatabase();
		try {
			const submission = await db4.get("SELECT * FROM submissions WHERE id = ?", submissionId);
			expect(submission.approved_on).toBeTruthy();
			expect(submission.approved_by).toBe(adminId);
			expect(submission.points).toBe(10);
			// Bound to the Species the committee picked
			expect(submission.species_id).toBeTruthy();
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

	test("changes path: draft → submit → witness → wait → changes → edit → resubmit → re-witness → approve", async ({ page }) => {
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

			// Create submission already in the approval queue (witnessed past
			// its waiting period, which is all it takes)
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
			// Asking for changes does not void the Witness; the member's save will
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
		// Opening the form is its own step now: clicking Edit no longer pulls
		// the Submission out of the queue it is waiting in.
		await page.click(`a[href="/submissions/${submissionId}/edit"]`);
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

		// Step 4: Verify changes_requested fields cleared and the Witness voided
		const db3 = await getTestDatabase();
		try {
			const submission = await db3.get("SELECT * FROM submissions WHERE id = ?", submissionId);
			expect(submission.changes_requested_on).toBeNull();
			expect(submission.changes_requested_by).toBeNull();
			expect(submission.changes_requested_reason).toBeNull();
			// Edits should be saved
			expect(submission.count).toBe("30");
			expect(submission.temperature).toBe("76");
			// The Witness attested to the form, so the member's edit voids it
			// (ADR-0001) and the Submission awaits a Witness again
			expect(submission.witnessed_by).toBeNull();
			expect(submission.witnessed_on).toBeNull();
			expect(submission.witness_verification_status).toBe("pending");
			// The void clears the points the witness set (ADR-0003)
			expect(submission.points).toBeNull();
		} finally {
			await db3.close();
		}

		// Step 5: Logout member, login as admin, re-witness and approve
		await logout(page);
		await login(page, TEST_ADMIN);

		await rewitness(page, submissionId);
		await approveFromQueue(page, submissionId);

		// Step 6: Verify final approved state
		const db4 = await getTestDatabase();
		try {
			const submission = await db4.get("SELECT * FROM submissions WHERE id = ?", submissionId);
			expect(submission.approved_on).toBeTruthy();
			expect(submission.approved_by).toBe(adminId);
			expect(submission.points).toBe(10);
			// Re-witnessed after the edit
			expect(submission.witnessed_by).toBe(adminId);
			expect(submission.witnessed_on).toBeTruthy();
		} finally {
			await db4.close();
		}
	});

	test("refusal path: submit → committee requests changes → verify the way back", async ({ page }) => {
		// Declining a Witness is deleted. A committee member who wants more
		// requests changes instead: same message, and it leaves the Submission
		// somewhere the member can act on rather than stranding it.
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

			// Submitted, awaiting a Witness.
			submissionId = await createTestSubmission({
				memberId: user.id,
				submitted: true,
				witnessed: false,
				reproductionDaysAgo: 70,
			});
		} finally {
			await db.close();
		}

		// Step 2: The committee asks for changes, with the problems stated.
		await login(page, TEST_ADMIN);

		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		const requestChangesButton = page.locator('button:has-text("Request Changes")');
		await requestChangesButton.scrollIntoViewIfNeeded();
		await requestChangesButton.click();

		await page.waitForSelector("form#feedbackForm", { timeout: 5000 });
		await page.fill('textarea[name="content"]', "Please add photos that clearly show the fry.");
		await page.click("#feedbackSubmitBtn");

		await page.waitForURL(/\/admin\/queue\//, { timeout: 10000 });
		await page.waitForLoadState("networkidle");

		// Step 3: The changes are outstanding and the Submission has not moved.
		const db2 = await getTestDatabase();
		try {
			const submission = await db2.get("SELECT * FROM submissions WHERE id = ?", submissionId);
			expect(submission.changes_requested_on).toBeTruthy();
			expect(submission.changes_requested_by).toBe(adminId);
			expect(submission.changes_requested_reason).toContain("photos");
			expect(submission.approved_on).toBeNull();
			// Still awaiting a Witness: asking for changes is not a screening outcome.
			expect(submission.witness_verification_status).toBe("pending");
		} finally {
			await db2.close();
		}

		// Step 4: While changes are outstanding the ball is with the member, so
		// the Submission has left the committee's screening queue.
		await page.goto("/admin/witness-queue/fish");
		await page.waitForLoadState("networkidle");
		await expect(page.locator(`a[href="/submissions/${submissionId}"]`)).toHaveCount(0);

		// Step 5: And the member is told what to do next.
		await logout(page);
		await login(page, TEST_USER);
		await page.goto(`/submissions/${submissionId}`);
		await expect(page.locator('h3:has-text("Changes Requested")')).toBeVisible();
		await expect(page.locator("text=Please add photos that clearly show the fry.")).toBeVisible();
	});

	test("complex path: witness → changes → resubmit → changes again → resubmit → re-witness → approve", async ({ page }) => {
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
			// its waiting period, which is all it takes)
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
		// Opening the form is its own step now: clicking Edit no longer pulls
		// the Submission out of the queue it is waiting in.
		await page.click(`a[href="/submissions/${submissionId}/edit"]`);
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
			// The resubmit voided the Witness (ADR-0001)
			expect(submission.witness_verification_status).toBe("pending");
		} finally {
			await db2.close();
		}

		// Step 4: Admin requests changes again (second time), now from the
		// witness step
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
		// Opening the form is its own step now: clicking Edit no longer pulls
		// the Submission out of the queue it is waiting in.
		await page.click(`a[href="/submissions/${submissionId}/edit"]`);
		await page.waitForSelector("#bapForm");

		await page.fill('input[name="substrate_type"]', "Sand");

		resubmitButton = page.locator('button[type="submit"]:has-text("Resubmit")');
		await resubmitButton.scrollIntoViewIfNeeded();
		await resubmitButton.click();

		await page.waitForURL(/\/submissions\/\d+/, { timeout: 10000 });
		await page.waitForLoadState("networkidle");

		// Step 6: Admin re-witnesses and approves
		await logout(page);
		await login(page, TEST_ADMIN);

		await rewitness(page, submissionId);
		await approveFromQueue(page, submissionId);

		// Step 7: Verify final state - witnessed again after the change cycles
		const db3 = await getTestDatabase();
		try {
			const submission = await db3.get("SELECT * FROM submissions WHERE id = ?", submissionId);
			expect(submission.approved_on).toBeTruthy();
			expect(submission.changes_requested_on).toBeNull();
			expect(submission.ph).toBe("7.5");
			expect(submission.substrate_type).toBe("Sand");
			// Confirmed by the re-witness, not carried over from before the edits
			expect(submission.witnessed_by).toBe(adminId);
			expect(submission.witnessed_on).toBeTruthy();
			expect(submission.witness_verification_status).toBe("confirmed");
		} finally {
			await db3.close();
		}
	});
});

test.describe("The approval queue needs no member action", () => {
	test.beforeEach(async () => {
		await cleanupTestUserSubmissions(TEST_USER.email);
		await ensureTestUserExists(TEST_USER.email, TEST_USER.password, TEST_USER.displayName, false);
		await ensureTestUserExists(TEST_ADMIN.email, TEST_ADMIN.password, TEST_ADMIN.displayName, true);
	});

	test("a witnessed submission past its waiting period is in the admin queue with nothing for the submitter to click", async ({ page }) => {
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

			// Witnessed past the waiting period, and nothing else
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

		// Step 1: The admin queue already contains it
		await login(page, TEST_ADMIN);
		await page.goto("/admin/queue/fish");
		await page.waitForLoadState("networkidle");

		const queueLink = page.locator(`a[href="/submissions/${submissionId}"]`);
		await expect(queueLink).toHaveCount(1);

		await logout(page);

		// Step 2: The submitter sees the "Bring to Meeting" panel, with no
		// button to enter or leave the queue
		await login(page, TEST_USER);
		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		await expect(page.locator('h3:has-text("Bring to Meeting")')).toBeVisible();
		await expect(page.locator('button:has-text("Brought to Meeting")')).toHaveCount(0);
		await expect(page.locator('button:has-text("Remove from Queue")')).toHaveCount(0);
	});
});
