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
 * Integration tests for request-changes validation
 * Tests state validation and error handling for the changes-requested workflow
 * Related to Issue #176
 */

void describe("Request Changes - State Validation", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void describe("Draft Submission Validation", () => {
    void test("should reject request changes on draft submission (not submitted)", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: false,
      });

      await assert.rejects(
        async () => await requestChanges(submissionId, ctx.admin.id, "Please add photos"),
        /Cannot request changes on draft submissions/
      );

      // Verify no changes_requested fields were set
      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_on, null);
      assert.strictEqual(submission?.changes_requested_by, null);
      assert.strictEqual(submission?.changes_requested_reason, null);
    });
  });

  void describe("Approved Submission Validation", () => {
    void test("should reject request changes on approved submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        approved: true,
        approvedBy: ctx.admin.id,
      });

      await assert.rejects(
        async () => await requestChanges(submissionId, ctx.admin.id, "Too late for changes"),
        /Cannot request changes on approved submissions/
      );

      // Verify no changes_requested fields were set
      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_on, null);
      assert.strictEqual(submission?.changes_requested_by, null);
      assert.strictEqual(submission?.changes_requested_reason, null);
    });
  });

  void describe("Denied Submission Validation", () => {
    void test("should reject request changes on denied submission", async () => {
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
  });

  void describe("Happy Path - Valid Submission", () => {
    void test("should successfully request changes on submitted+witnessed submission", async () => {
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

      // Verify witness data preserved
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

      // Second request (should update, not error)
      await requestChanges(submissionId, ctx.admin.id, "Updated feedback");

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, "Updated feedback");
    });
  });

  void describe("Non-existent Submission", () => {
    void test("should reject non-existent submission", async () => {
      const nonExistentId = 99999;

      await assert.rejects(
        async () => await requestChanges(nonExistentId, ctx.admin.id, "Feedback"),
        /Submission not found/
      );
    });
  });
});
