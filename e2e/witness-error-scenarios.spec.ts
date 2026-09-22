import { test, expect } from "@playwright/test";
import { login } from "./helpers/auth";
import { createTestSubmission } from "./helpers/submissions";
import { getTestDatabase, TEST_USER, TEST_ADMIN } from "./helpers/testData";

/**
 * E2E tests for the screening gate's error surfaces.
 *
 * Tests:
 * - Self-witnessing attempts (UI prevents via warning message)
 * - Witnessing already-confirmed submissions (UI handles gracefully)
 * - Rows left `declined` by the deleted decline path being screenable again
 * - Missing/invalid change-request reasons (client-side validation)
 *
 * Declining a Witness no longer exists: it emailed the member and left the
 * Submission where nothing could move it out. A committee member who wants
 * more requests changes instead, which states the problems and has a way back.
 */

test.describe("Witness Error Scenarios", () => {
  test("should prevent admin from witnessing their own submission via UI", async ({ page }) => {
    // Step 1: Create submission as admin (self-submission)
    const db = await getTestDatabase();
    let submissionId: number;

    try {
      const admin = await db.get<{ id: number }>(
        "SELECT id FROM members WHERE contact_email = ?",
        TEST_ADMIN.email
      );

      if (!admin) {
        throw new Error("Test admin not found in database");
      }

      // Create submission BY the admin (self-witnessing scenario)
      submissionId = await createTestSubmission({
        memberId: admin.id, // Admin's own submission
        submitted: true,
        witnessed: false,
      });
    } finally {
      await db.close();
    }

    // Step 2: Login as admin
    await login(page, TEST_ADMIN);

    // Step 3: Navigate to the submission
    await page.goto(`/submissions/${submissionId}`);
    await page.waitForSelector("body");

    // Step 4: Verify UI prevents self-witnessing
    // The UI should show a warning message instead of action buttons
    const warningMessage = page.locator("text=/cannot screen your own submissions/i");
    await expect(warningMessage).toBeVisible({ timeout: 5000 });

    // Verify action buttons are NOT present
    const approveButton = page.locator('button:has-text("Approve for Screening")');
    await expect(approveButton).not.toBeVisible();

    const requestChangesButton = page.locator('button:has-text("Request Changes")');
    await expect(requestChangesButton).not.toBeVisible();

    // Step 5: Verify submission state unchanged
    const db2 = await getTestDatabase();
    try {
      const submission = await db2.get("SELECT * FROM submissions WHERE id = ?", submissionId);

      // Should still be in pending state
      expect(submission.witness_verification_status).toBe("pending");
      expect(submission.witnessed_by).toBeNull();
      expect(submission.witnessed_on).toBeNull();
    } finally {
      await db2.close();
    }
  });

  test("should handle already-witnessed submission gracefully", async ({ page }) => {
    // Step 1: Create submission that's already witnessed
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

      // Create submission already witnessed
      submissionId = await createTestSubmission({
        memberId: user.id,
        submitted: true,
        witnessed: true,
        witnessedBy: adminId,
        witnessedDaysAgo: 1,
      });
    } finally {
      await db.close();
    }

    // Step 2: Login as admin
    await login(page, TEST_ADMIN);

    // Step 3: Navigate to the submission
    await page.goto(`/submissions/${submissionId}`);
    await page.waitForSelector("body");

    // Step 4: Verify UI doesn't show witness action buttons for already-witnessed submission
    // The screening panel should not be visible
    const approveButton = page.locator('button:has-text("Approve for Screening")');
    await expect(approveButton).not.toBeVisible();

    // Step 5: Verify submission state unchanged
    const db2 = await getTestDatabase();
    try {
      const submission = await db2.get("SELECT * FROM submissions WHERE id = ?", submissionId);

      expect(submission.witness_verification_status).toBe("confirmed");
      expect(submission.witnessed_by).toBe(adminId);
    } finally {
      await db2.close();
    }
  });

  test("a submission left 'declined' by the deleted decline path is screenable again", async ({
    page,
  }) => {
    // Declining set this status and left the submission where nothing could
    // move it out - invisible in every committee queue while showing the
    // member "Pending Review". Nothing writes the value any more, but
    // production rows may still carry it, so the state derivation reads it as
    // awaiting a Witness. This test pins that rescue.
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

      submissionId = await createTestSubmission({
        memberId: user.id,
        submitted: true,
        witnessed: false,
        bound: true,
      });

      // A row as the deleted decline path would have left it.
      await db.run(
        `UPDATE submissions
					SET witness_verification_status = 'declined',
					    witnessed_by = ?,
					    witnessed_on = ?
					WHERE id = ?`,
        adminId,
        new Date().toISOString(),
        submissionId
      );
    } finally {
      await db.close();
    }

    await login(page, TEST_ADMIN);
    await page.goto(`/submissions/${submissionId}`);
    await page.waitForSelector("body");

    // The screening panel is offered again, so a committee member can move it.
    const approveButton = page.locator('button:has-text("Approve for Screening")');
    await expect(approveButton).toBeVisible({ timeout: 5000 });

    await approveButton.click();
    await page.waitForURL(/\/admin\/witness-queue\//, { timeout: 10000 });

    const db2 = await getTestDatabase();
    try {
      const submission = await db2.get("SELECT * FROM submissions WHERE id = ?", submissionId);
      expect(submission.witness_verification_status).toBe("confirmed");
    } finally {
      await db2.close();
    }
  });

  test("should enforce client-side validation for the change-request reason", async ({ page }) => {
    // Step 1: Create submitted submission
    const db = await getTestDatabase();
    let submissionId: number;

    try {
      const user = await db.get<{ id: number }>(
        "SELECT id FROM members WHERE contact_email = ?",
        TEST_USER.email
      );

      if (!user) {
        throw new Error("Test user not found");
      }

      submissionId = await createTestSubmission({
        memberId: user.id,
        submitted: true,
        witnessed: false,
      });
    } finally {
      await db.close();
    }

    // Step 2: Login as admin
    await login(page, TEST_ADMIN);

    // Step 3: Navigate to submission
    await page.goto(`/submissions/${submissionId}`);
    await page.waitForSelector("body");

    // Step 4: Open the Request Changes dialog
    const requestChangesButton = page.locator('button:has-text("Request Changes")');
    await requestChangesButton.scrollIntoViewIfNeeded();
    await requestChangesButton.click();

    // Step 5: Wait for dialog and verify form validation
    await page.waitForSelector("form#feedbackForm", { timeout: 5000 });

    const reasonTextarea = page.locator('textarea[name="content"]');
    await expect(reasonTextarea).toBeVisible();

    const isRequired = await reasonTextarea.getAttribute("required");
    expect(isRequired).not.toBeNull();

    const minLength = await reasonTextarea.getAttribute("minlength");
    expect(minLength).toBe("10");

    // Step 6: Fill with a valid reason and send
    await reasonTextarea.fill("Additional documentation is needed to verify this spawn.");
    await page.click("#feedbackSubmitBtn");

    // The committee is sent back to the approval queue for the Program.
    await page.waitForURL(/\/admin\/queue\//, { timeout: 10000 });

    // Step 7: The changes are outstanding, and the Witness is untouched: a
    // request for changes is a refusal with a way back, not a dead end.
    const db2 = await getTestDatabase();
    try {
      const submission = await db2.get("SELECT * FROM submissions WHERE id = ?", submissionId);

      expect(submission.changes_requested_on).toBeTruthy();
      expect(submission.changes_requested_reason).toContain("Additional documentation");
      expect(submission.witness_verification_status).toBe("pending");
      expect(submission.witnessed_on).toBeNull();
    } finally {
      await db2.close();
    }
  });
});
