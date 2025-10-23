import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { deleteSubmissionWithAuth, getSubmissionById } from "../db/submissions";
import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestSubmission,
  createTestMember,
  type TestContext,
} from "./helpers/testHelpers";

/**
 * Integration tests for submission deletion authorization
 * Tests that deletions are properly authorized based on ownership and approval state
 */

void describe("Submission Deletion - Authorization", () => {
  let ctx: TestContext;
  let member2: { id: number };

  beforeEach(async () => {
    ctx = await setupTestDatabase();
    // Create a second regular member for cross-ownership tests
    member2 = await createTestMember(ctx.db, { email: `member2-${Date.now()}@test.com` });
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void describe("Owner Permissions", () => {
    void test("should allow member to delete their own draft submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: false,
      });

      await deleteSubmissionWithAuth(submissionId, ctx.member.id, false);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission, undefined);
    });

    void test("should allow member to delete their own submitted but unapproved submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
      });

      await deleteSubmissionWithAuth(submissionId, ctx.member.id, false);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission, undefined);
    });

    void test("should NOT allow member to delete their own approved submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        approved: true,
        approvedBy: ctx.admin.id,
      });

      await assert.rejects(
        async () => await deleteSubmissionWithAuth(submissionId, ctx.member.id, false),
        /Cannot delete approved submissions/
      );

      // Verify submission still exists
      const submission = await getSubmissionById(submissionId);
      assert.ok(submission !== undefined);
    });

    void test("should NOT allow member to delete another member's submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: member2.id,
        submitted: false,
      });

      await assert.rejects(
        async () => await deleteSubmissionWithAuth(submissionId, ctx.member.id, false),
        /Cannot delete another member's submission/
      );

      // Verify submission still exists
      const submission = await getSubmissionById(submissionId);
      assert.ok(submission !== undefined);
    });
  });

  void describe("Admin Permissions", () => {
    void test("should allow admin to delete any draft submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: false,
      });

      await deleteSubmissionWithAuth(submissionId, ctx.admin.id, true);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission, undefined);
    });

    void test("should allow admin to delete any submitted but unapproved submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
      });

      await deleteSubmissionWithAuth(submissionId, ctx.admin.id, true);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission, undefined);
    });

    void test("should allow admin to delete their own approved submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.admin.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        approved: true,
        approvedBy: ctx.admin.id,
      });

      await deleteSubmissionWithAuth(submissionId, ctx.admin.id, true);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission, undefined);
    });

    void test("should allow admin to delete another member's approved submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        approved: true,
        approvedBy: ctx.admin.id,
      });

      // Admins can delete any submission, including approved ones
      await deleteSubmissionWithAuth(submissionId, ctx.admin.id, true);

      // Verify submission was deleted
      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission, undefined);
    });
  });

  void describe("Edge Cases", () => {
    void test("should handle non-existent submission gracefully", async () => {
      const nonExistentId = 99999;

      await assert.rejects(
        async () => await deleteSubmissionWithAuth(nonExistentId, ctx.member.id, false),
        /Submission not found/
      );
    });

    void test("should handle deletion of submission with photos and audit trail", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      // Request changes to create audit trail
      await ctx.db.run(
        `UPDATE submissions SET
          changes_requested_on = ?,
          changes_requested_by = ?,
          changes_requested_reason = ?
        WHERE id = ?`,
        [new Date().toISOString(), ctx.admin.id, "Test feedback", submissionId]
      );

      await deleteSubmissionWithAuth(submissionId, ctx.member.id, false);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission, undefined);
    });

    void test("should prevent deletion with isAdmin=false even if user is admin in database", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: member2.id,
        submitted: false,
      });

      // Admin tries to delete but passes isAdmin=false (should be rejected)
      await assert.rejects(
        async () => await deleteSubmissionWithAuth(submissionId, ctx.admin.id, false),
        /Cannot delete another member's submission/
      );

      // Verify submission still exists
      const submission = await getSubmissionById(submissionId);
      assert.ok(submission !== undefined);
    });

    void test("should handle deletion of witnessed but not approved submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await deleteSubmissionWithAuth(submissionId, ctx.member.id, false);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission, undefined);
    });

    void test("should handle deletion of witnessed and declined submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "declined",
        witnessedBy: ctx.admin.id,
      });

      await deleteSubmissionWithAuth(submissionId, ctx.member.id, false);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission, undefined);
    });

    void test("should handle deletion of denied submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        denied: true,
        deniedBy: ctx.admin.id,
      });

      await deleteSubmissionWithAuth(submissionId, ctx.member.id, false);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission, undefined);
    });
  });
});
