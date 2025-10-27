import { test, expect } from "@playwright/test";
import { login } from "./helpers/auth";
import { createTestSubmission } from "./helpers/submissions";
import { getTestDatabase, TEST_USER, TEST_ADMIN } from "./helpers/testData";

/**
 * E2E tests for witness error scenarios
 *
 * Tests the error handling for:
 * - Self-witnessing attempts (UI prevents via warning message)
 * - Witnessing already-confirmed submissions (UI handles gracefully)
 * - Witnessing declined submissions (UI handles gracefully)
 * - Missing/invalid decline reasons (client-side validation)
 *
 * These tests verify that error surfaces work correctly through the full stack
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

    const requestInfoButton = page.locator('button:has-text("Request More Info")');
    await expect(requestInfoButton).not.toBeVisible();

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

  test("should handle declined submission state correctly", async ({ page }) => {
    // Step 1: Create submission that's been declined
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

      // Create submitted submission
      submissionId = await createTestSubmission({
        memberId: user.id,
        submitted: true,
        witnessed: false,
      });

      // Manually set to declined state
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

    // Step 2: Login as admin
    await login(page, TEST_ADMIN);

    // Step 3: Navigate to the submission
    await page.goto(`/submissions/${submissionId}`);
    await page.waitForSelector("body");

    // Step 4: Verify UI handles declined submission appropriately
    // Declined submissions should not show the approve button
    const approveButton = page.locator('button:has-text("Approve for Screening")');
    await expect(approveButton).not.toBeVisible();

    // Step 5: Verify submission still in declined state
    const db2 = await getTestDatabase();
    try {
      const submission = await db2.get("SELECT * FROM submissions WHERE id = ?", submissionId);

      expect(submission.witness_verification_status).toBe("declined");
    } finally {
      await db2.close();
    }
  });

  test("should enforce client-side validation for decline reason", async ({ page }) => {
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

    // Step 4: Click "Request More Info" button
    const requestInfoButton = page.locator('button:has-text("Request More Info")');
    await requestInfoButton.scrollIntoViewIfNeeded();
    await requestInfoButton.click();

    // Step 5: Wait for dialog and verify form validation
    await page.waitForSelector("form#witnessForm", { timeout: 5000 });

    // Get the textarea element and verify it has validation attributes
    const reasonTextarea = page.locator('textarea[name="reason"]');
    await expect(reasonTextarea).toBeVisible();

    // Verify required attribute
    const isRequired = await reasonTextarea.getAttribute("required");
    expect(isRequired).not.toBeNull();

    // Verify minlength attribute
    const minLength = await reasonTextarea.getAttribute("minlength");
    expect(minLength).toBe("10");

    // Step 6: Fill with valid reason and submit successfully
    await reasonTextarea.fill("Additional documentation is needed to verify this spawn.");

    const submitButton = page.locator('form#witnessForm button[type="submit"]');
    await submitButton.click();

    // Should redirect to witness queue
    await page.waitForURL(/\/admin\/witness-queue\//, { timeout: 10000 });

    // Step 7: Verify submission was declined
    const db2 = await getTestDatabase();
    try {
      const submission = await db2.get("SELECT * FROM submissions WHERE id = ?", submissionId);

      expect(submission.witness_verification_status).toBe("declined");
    } finally {
      await db2.close();
    }
  });
});
