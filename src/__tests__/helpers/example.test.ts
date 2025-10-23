import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestSubmission,
  createTestMember,
  assertSubmissionState,
  mockApprovalData,
  mockSpeciesIds,
  type TestContext,
} from "./testHelpers";
import { getSubmissionById, approveSubmission } from "../../db/submissions";

/**
 * Example test file demonstrating the usage of test helpers
 *
 * This file shows how to:
 * - Set up and tear down test databases
 * - Create test members and submissions
 * - Use assertion helpers
 * - Write clean, maintainable tests
 */

void describe("Example Test Using Helpers", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    // Set up database with 2 admins and 1 member
    ctx = await setupTestDatabase({ adminCount: 2, memberCount: 1 });
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void describe("Database Setup", () => {
    void test("should create test database with users", async () => {
      assert.ok(ctx.db);
      assert.ok(ctx.member);
      assert.ok(ctx.admin);
      assert.ok(ctx.otherAdmin);
      assert.strictEqual(ctx.member.display_name, "Test Member");
      assert.strictEqual(ctx.admin.display_name, "Test Admin");
    });
  });

  void describe("Submission Fixtures", () => {
    void test("should create draft submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
      });

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission);
      assert.strictEqual(submission.member_id, ctx.member.id);
      assertSubmissionState(submission, {
        submitted: false,
        witnessed: false,
        approved: false,
      });
    });

    void test("should create submitted submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
      });

      const submission = await getSubmissionById(submissionId);
      assertSubmissionState(submission, {
        submitted: true,
        witnessed: false,
        approved: false,
      });
    });

    void test("should create witnessed submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      const submission = await getSubmissionById(submissionId);
      assertSubmissionState(submission, {
        submitted: true,
        witnessed: true,
        approved: false,
      });
      assert.strictEqual(submission.witnessed_by, ctx.admin.id);
    });

    void test("should create approved submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        approved: true,
        approvedBy: ctx.admin.id,
        points: 15,
        articlePoints: 5,
      });

      const submission = await getSubmissionById(submissionId);
      assertSubmissionState(submission, {
        submitted: true,
        witnessed: true,
        approved: true,
      });
      assert.strictEqual(submission.points, 15);
      assert.strictEqual(submission.article_points, 5);
    });

    void test("should create submission with custom species", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        speciesType: "Plant",
        speciesClass: "Aquatic Plants",
        commonName: "Amazon Sword",
        latinName: "Echinodorus amazonicus",
        program: "plant",
      });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission.species_type, "Plant");
      assert.strictEqual(submission.species_common_name, "Amazon Sword");
      assert.strictEqual(submission.program, "plant");
    });
  });

  void describe("Member Fixtures", () => {
    void test("should create additional test members", async () => {
      const newMember = await createTestMember({
        displayName: "Jane Doe",
        email: "jane@test.com",
      });

      assert.ok(newMember);
      assert.strictEqual(newMember.display_name, "Jane Doe");
      assert.strictEqual(newMember.contact_email, "jane@test.com");
    });
  });

  void describe("Integration with Real Functions", () => {
    void test("should work with real approval function", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await approveSubmission(ctx.admin.id, submissionId, mockSpeciesIds, {
        ...mockApprovalData,
        points: 20,
      });

      const submission = await getSubmissionById(submissionId);
      assertSubmissionState(submission, {
        approved: true,
      });
      assert.strictEqual(submission.points, 20);
      assert.strictEqual(submission.approved_by, ctx.admin.id);
    });
  });
});
