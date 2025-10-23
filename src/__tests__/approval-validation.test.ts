import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { approveSubmission, getSubmissionById } from "../db/submissions";
import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestSubmission,
  mockApprovalData,
  mockSpeciesIds,
  type TestContext,
} from "./helpers/testHelpers";

/**
 * Integration tests for submission approval validation
 * Tests state validation and points calculation for the approval workflow
 */

void describe("Submission Approval - State Validation", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void describe("Draft Submission Validation", () => {
    void test("should reject approval of draft submission (not submitted)", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: false,
      });

      await assert.rejects(
        async () => await approveSubmission(ctx.admin.id, submissionId, mockSpeciesIds, mockApprovalData),
        /Cannot approve draft submissions/
      );

      // Verify submission remains unapproved
      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.approved_on, null);
      assert.strictEqual(submission?.approved_by, null);
      assert.strictEqual(submission?.points, null);
    });
  });

  void describe("Already Approved Validation", () => {
    void test("should reject re-approval of already approved submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        approved: true,
        approvedBy: ctx.admin.id,
        points: 10,
      });

      await assert.rejects(
        async () => await approveSubmission(ctx.admin.id, submissionId, mockSpeciesIds, mockApprovalData),
        /Cannot approve already approved submissions/
      );

      // Verify original approval data unchanged
      const submission = await getSubmissionById(submissionId);
      assert.ok(submission?.approved_on !== null);
      assert.strictEqual(submission?.points, 10);
    });
  });

  void describe("Denied Submission Validation", () => {
    void test("should reject approval of denied submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        denied: true,
        deniedBy: ctx.admin.id,
      });

      await assert.rejects(
        async () => await approveSubmission(ctx.admin.id, submissionId, mockSpeciesIds, mockApprovalData),
        /Cannot approve denied submissions/
      );

      // Verify submission remains denied (not approved)
      const submission = await getSubmissionById(submissionId);
      assert.ok(submission?.denied_on !== null);
      assert.strictEqual(submission?.approved_on, null);
    });
  });

  void describe("Happy Path - Valid Approval", () => {
    void test("should successfully approve submitted+witnessed submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await approveSubmission(ctx.admin.id, submissionId, mockSpeciesIds, {
        ...mockApprovalData,
        points: 15,
      });

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission?.approved_on !== null);
      assert.strictEqual(submission?.approved_by, ctx.admin.id);
      assert.strictEqual(submission?.points, 15);
      assert.strictEqual(submission?.common_name_id, 1);
      assert.strictEqual(submission?.scientific_name_id, 1);
    });

    void test("should apply first-time species bonus correctly", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await approveSubmission(ctx.admin.id, submissionId, mockSpeciesIds, {
        ...mockApprovalData,
        points: 10,
        first_time_species: true,
      });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 10);
      assert.strictEqual(submission?.first_time_species, 1);
    });

    void test("should apply CARES species bonus correctly", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await approveSubmission(ctx.admin.id, submissionId, mockSpeciesIds, {
        ...mockApprovalData,
        points: 10,
        cares_species: true,
      });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 10);
      assert.strictEqual(submission?.cares_species, 1);
    });

    void test("should apply article points correctly", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await approveSubmission(ctx.admin.id, submissionId, mockSpeciesIds, {
        ...mockApprovalData,
        points: 10,
        article_points: 5,
      });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 10);
      assert.strictEqual(submission?.article_points, 5);
    });

    void test("should apply plant bonuses correctly", async () => {
      const plantSubmissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        speciesType: "Plant",
        speciesClass: "Aquatic Plants",
        commonName: "Amazon Sword",
        latinName: "Echinodorus amazonicus",
        program: "plant",
      });

      await approveSubmission(ctx.admin.id, plantSubmissionId, mockSpeciesIds, {
        ...mockApprovalData,
        points: 10,
        flowered: true,
        sexual_reproduction: true,
      });

      const submission = await getSubmissionById(plantSubmissionId);
      assert.strictEqual(submission?.points, 10);
      assert.strictEqual(submission?.flowered, 1);
      assert.strictEqual(submission?.sexual_reproduction, 1);
    });
  });

  void describe("Non-existent Submission", () => {
    void test("should reject approval of non-existent submission", async () => {
      const nonExistentId = 99999;

      await assert.rejects(
        async () => await approveSubmission(ctx.admin.id, nonExistentId, mockSpeciesIds, mockApprovalData),
        /Submission not found/
      );
    });
  });
});
