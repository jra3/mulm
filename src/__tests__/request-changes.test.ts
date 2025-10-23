import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { requestChanges, getSubmissionById } from "../db/submissions";
import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestSubmission,
  type TestContext,
} from "./helpers/testHelpers";

/**
 * Integration tests for request changes workflow
 * Tests state validation and audit trail for admin-requested changes
 */

void describe("Request Changes Workflow", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void describe("Happy Path", () => {
    void test("should successfully request changes on witnessed submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await requestChanges(submissionId, ctx.admin.id, "Please add more photos");

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission?.changes_requested_on !== null);
      assert.strictEqual(submission?.changes_requested_by, ctx.admin.id);
      assert.strictEqual(submission?.changes_requested_reason, "Please add more photos");
    });

    void test("should set changes_requested_on timestamp", async () => {
      const beforeTime = Date.now();
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await requestChanges(submissionId, ctx.admin.id, "Feedback");
      const afterTime = Date.now();

      const submission = await getSubmissionById(submissionId);
      const requestedTime = new Date(submission!.changes_requested_on!).getTime();

      assert.ok(requestedTime >= beforeTime);
      assert.ok(requestedTime <= afterTime);
    });

    void test("should preserve witness information when requesting changes", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await requestChanges(submissionId, ctx.admin.id, "Feedback");

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.witnessed_by, ctx.admin.id);
      assert.ok(submission?.witnessed_on !== null);
      assert.strictEqual(submission?.witness_verification_status, "confirmed");
    });

    void test("should allow multiple change requests (updates reason)", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      // First request
      await requestChanges(submissionId, ctx.admin.id, "First feedback");
      let submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, "First feedback");

      // Second request (should update, not error)
      await requestChanges(submissionId, ctx.admin.id, "Updated feedback");
      submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, "Updated feedback");
    });
  });

  void describe("State Validation", () => {
    void test("should reject changes on draft submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: false,
      });

      await assert.rejects(
        async () => await requestChanges(submissionId, ctx.admin.id, "Feedback"),
        /Cannot request changes on draft submissions/
      );

      // Verify no changes_requested fields were set
      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_on, null);
      assert.strictEqual(submission?.changes_requested_by, null);
      assert.strictEqual(submission?.changes_requested_reason, null);
    });

    void test("should reject changes on approved submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        approved: true,
        approvedBy: ctx.admin.id,
      });

      await assert.rejects(
        async () => await requestChanges(submissionId, ctx.admin.id, "Too late"),
        /Cannot request changes on approved submissions/
      );

      // Verify no changes_requested fields were set
      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_on, null);
      assert.strictEqual(submission?.changes_requested_by, null);
      assert.strictEqual(submission?.changes_requested_reason, null);
    });

    void test("should reject changes on denied submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        denied: true,
        deniedBy: ctx.admin.id,
      });

      await assert.rejects(
        async () => await requestChanges(submissionId, ctx.admin.id, "Already denied"),
        /Cannot request changes on denied submissions/
      );

      // Verify no changes_requested fields were set
      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_on, null);
      assert.strictEqual(submission?.changes_requested_by, null);
      assert.strictEqual(submission?.changes_requested_reason, null);
    });

    void test("should reject changes on non-existent submission", async () => {
      const nonExistentId = 99999;

      await assert.rejects(
        async () => await requestChanges(nonExistentId, ctx.admin.id, "Feedback"),
        /Submission not found/
      );
    });
  });

  void describe("Resubmit After Changes", () => {
    void test("should allow member to resubmit after changes requested", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await requestChanges(submissionId, ctx.admin.id, "Add photos");

      let submission = await getSubmissionById(submissionId);
      assert.ok(submission?.changes_requested_on !== null);

      // Simulate member resubmit (clear changes_requested fields)
      await ctx.db.run(
        `UPDATE submissions SET
          changes_requested_on = NULL,
          changes_requested_by = NULL,
          changes_requested_reason = NULL
        WHERE id = ?`,
        [submissionId]
      );

      submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_on, null);
      assert.strictEqual(submission?.changes_requested_by, null);
      assert.strictEqual(submission?.changes_requested_reason, null);

      // Should still preserve witness and submission data
      assert.ok(submission?.submitted_on !== null);
      assert.strictEqual(submission?.witnessed_by, ctx.admin.id);
      assert.strictEqual(submission?.witness_verification_status, "confirmed");
    });

    void test("should allow admin to request changes again after member resubmits", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      // First request
      await requestChanges(submissionId, ctx.admin.id, "First request");

      // Member resubmits
      await ctx.db.run(
        `UPDATE submissions SET
          changes_requested_on = NULL,
          changes_requested_by = NULL,
          changes_requested_reason = NULL
        WHERE id = ?`,
        [submissionId]
      );

      // Second request (should succeed)
      await requestChanges(submissionId, ctx.admin.id, "Second request");

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, "Second request");
    });

    void test("should preserve original submitted_on when resubmitting", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      const originalSubmission = await getSubmissionById(submissionId);
      const originalSubmittedOn = originalSubmission?.submitted_on;

      await requestChanges(submissionId, ctx.admin.id, "Add photos");

      // Wait a bit to ensure timestamp would be different if changed
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Member resubmits
      await ctx.db.run(
        `UPDATE submissions SET
          changes_requested_on = NULL,
          changes_requested_by = NULL,
          changes_requested_reason = NULL
        WHERE id = ?`,
        [submissionId]
      );

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.submitted_on, originalSubmittedOn);
    });
  });

  void describe("Audit Trail", () => {
    void test("should record who requested changes", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await requestChanges(submissionId, ctx.admin.id, "Feedback");

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_by, ctx.admin.id);
    });

    void test("should record reason for changes", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      const reason = "Please provide better photos of fry";
      await requestChanges(submissionId, ctx.admin.id, reason);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, reason);
    });

    void test("should record timestamp of change request", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await requestChanges(submissionId, ctx.admin.id, "Feedback");

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission?.changes_requested_on !== null);
      assert.ok(new Date(submission.changes_requested_on).getTime() > 0);
    });

    void test("should handle long feedback messages", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      const longReason = "A".repeat(500) + " Please add more detail.";
      await requestChanges(submissionId, ctx.admin.id, longReason);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, longReason);
    });

    void test("should handle special characters in feedback", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      const specialReason = 'Please add "photos" & <details>';
      await requestChanges(submissionId, ctx.admin.id, specialReason);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, specialReason);
    });
  });

  void describe("Edge Cases", () => {
    void test("should handle empty reason string", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await requestChanges(submissionId, ctx.admin.id, "");

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, "");
    });

    void test("should handle whitespace-only reason", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await requestChanges(submissionId, ctx.admin.id, "   ");

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, "   ");
    });

    void test("should handle unicode characters in reason", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      const unicodeReason = "Please add 🐟 photos with café lighting";
      await requestChanges(submissionId, ctx.admin.id, unicodeReason);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, unicodeReason);
    });
  });

  void describe("Integration with Other States", () => {
    void test("should work with submitted but not yet witnessed submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "pending",
      });

      await requestChanges(submissionId, ctx.admin.id, "Feedback");

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission?.changes_requested_on !== null);
      assert.strictEqual(submission?.witness_verification_status, "pending");
    });

    void test("should work with witnessed and declined submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "declined",
        witnessedBy: ctx.admin.id,
      });

      await requestChanges(submissionId, ctx.admin.id, "Feedback");

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission?.changes_requested_on !== null);
      assert.strictEqual(submission?.witness_verification_status, "declined");
    });
  });
});
