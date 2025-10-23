import { test, expect } from "@playwright/test";
import { login } from "./helpers/auth";
import { TEST_USER, TEST_ADMIN, cleanupTestUserSubmissions, getTestDatabase, ensureTestUserExists } from "./helpers/testData";
import { createTestSubmission } from "./helpers/submissions";

/**
 * Submission Status Display Tests
 *
 * Verifies that the changes-requested status is correctly displayed across different views
 * with proper styling, icons, and colors.
 *
 * Related to Issue #177: Add e2e tests for changes-requested status display
 */

test.describe.configure({ mode: 'serial' });

test.describe("Changes-Requested Status Display", () => {
	let submissionId: number;
	let memberId: number;
	let adminId: number;

	test.beforeAll(async () => {
		// Clean up and ensure test users exist
		await cleanupTestUserSubmissions(TEST_USER.email);
		await ensureTestUserExists(TEST_USER.email, TEST_USER.password, TEST_USER.displayName, false);
		await ensureTestUserExists(TEST_ADMIN.email, TEST_ADMIN.password, TEST_ADMIN.displayName, true);

		// Create a submission with changes requested
		const db = await getTestDatabase();
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
				throw new Error("Test users not found");
			}

			memberId = user.id;
			adminId = admin.id;

			// Create witnessed submission with changes requested
			submissionId = await createTestSubmission({
				memberId: user.id,
				submitted: true,
				witnessed: true,
				witnessedBy: admin.id,
				witnessedDaysAgo: 70,
				reproductionDaysAgo: 70,
			});

			// Set changes_requested fields
			await db.run(
				`UPDATE submissions SET
					changes_requested_on = ?,
					changes_requested_by = ?,
					changes_requested_reason = ?
				WHERE id = ?`,
				new Date().toISOString(),
				admin.id,
				"Please add more photos and details about water parameters",
				submissionId
			);
		} finally {
			await db.close();
		}
	});

	test("member profile shows changes-requested badge with correct styling", async ({ page }) => {
		await login(page, TEST_USER);

		// Navigate to member profile
		await page.goto("/me");
		await page.waitForSelector("body");

		// Verify status badge is visible with correct text
		const badge = page.locator('text=Changes Requested').first();
		await expect(badge).toBeVisible();

		// Verify badge has orange color styling (check parent span element)
		const orangeBadge = page.locator('span.bg-orange-100.text-orange-800').first();
		await expect(orangeBadge).toBeVisible();
		await expect(orangeBadge).toContainText('Changes Requested');

		// Verify row has orange background color
		const orangeRow = page.locator('tr.bg-orange-50').first();
		await expect(orangeRow).toBeVisible();
	});

	test("admin queue shows changes-requested badge with correct styling", async ({ page }) => {
		await login(page, TEST_ADMIN);

		// Navigate to admin queue
		await page.goto("/admin/queue/fish");
		await page.waitForSelector("body");

		// Verify status badge is visible in the queue table
		const badge = page.locator('text=Changes Requested').first();
		await expect(badge).toBeVisible();

		// Verify badge has orange color styling
		const orangeBadge = page.locator('span.bg-orange-100.text-orange-800').first();
		await expect(orangeBadge).toBeVisible();
		await expect(orangeBadge).toContainText('Changes Requested');

		// Verify row has orange background color
		const orangeRow = page.locator('tr.bg-orange-50').first();
		await expect(orangeRow).toBeVisible();
	});

	test("submission form shows changes-requested banner", async ({ page }) => {
		await login(page, TEST_USER);

		// Navigate to submission with changes requested
		await page.goto(`/submissions/${submissionId}`);
		await page.waitForSelector("body");

		// Verify yellow warning banner appears
		const banner = page.locator('.status-panel-warning');
		await expect(banner).toBeVisible();

		// Verify heading with icon
		const heading = page.locator('h3:has-text("📝 Changes Requested")');
		await expect(heading).toBeVisible();

		// Verify admin feedback is shown
		const feedback = page.locator('text=Please add more photos and details about water parameters');
		await expect(feedback).toBeVisible();

		// Verify "Resubmit" button is present
		const resubmitButton = page.locator('button:has-text("Resubmit")');
		await expect(resubmitButton).toBeVisible();

		// Verify witness preservation notice (if witnessed)
		const witnessNotice = page.locator('text=Your witness confirmation is preserved');
		await expect(witnessNotice).toBeVisible();
	});

	test("status badge has correct tooltip/title", async ({ page }) => {
		await login(page, TEST_USER);

		await page.goto("/me");
		await page.waitForSelector("body");

		// Verify badge has descriptive title attribute
		const badge = page.locator('span:has-text("Changes Requested")').first();
		await expect(badge).toHaveAttribute('title', 'Admin requested changes - edit and resubmit');
	});
});
