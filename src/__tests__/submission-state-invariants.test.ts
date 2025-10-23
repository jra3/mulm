import { describe, test, beforeEach, afterEach } from "node:test";
import {
  getSubmissionById,
  confirmWitness,
  declineWitness,
  approveSubmission,
  requestChanges,
  updateSubmission,
} from "../db/submissions";
import { assertSubmissionInvariantsHold } from "./helpers/assertInvariants";
import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestSubmission,
  mockApprovalData,
  mockSpeciesIds,
  type TestContext,
} from "./helpers/testHelpers";

/**
 * Submission State Machine Invariant Tests
 *
 * These tests verify that ALL state transitions maintain critical invariants.
 * Invariants are rules that must ALWAYS be true, regardless of code path taken.
 *
 * If an invariant is violated, it indicates a serious bug that could corrupt data.
 * Related to Issue #172
 */

void describe("Submission State Machine - Invariant Tests", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void describe("Draft State Invariants", () => {
    void test("draft submission maintains invariants", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: false,
      });

      const submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });
  });

  void describe("Submitted State Transition Invariants", () => {
    void test("submitting draft maintains invariants", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: false,
      });

      // Simulate submission
      await updateSubmission(submissionId, {
        submitted_on: new Date().toISOString(),
        witness_verification_status: "pending",
      });

      const submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });
  });

  void describe("Witness Confirmation Invariants", () => {
    void test("confirming witness maintains invariants", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
      });

      await confirmWitness(submissionId, ctx.admin.id);

      const submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });

    void test("declining witness maintains invariants", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
      });

      await declineWitness(submissionId, ctx.admin.id);

      const submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });
  });

  void describe("Approval Transition Invariants", () => {
    void test("approving submission maintains invariants", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await approveSubmission(ctx.admin.id, submissionId, mockSpeciesIds, mockApprovalData);

      const submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });

    void test("approval with all bonuses maintains invariants", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await approveSubmission(ctx.admin.id, submissionId, mockSpeciesIds, {
        ...mockApprovalData,
        points: 15,
        article_points: 5,
        first_time_species: true,
        cares_species: true,
      });

      const submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });
  });

  void describe("Changes Requested Invariants", () => {
    void test("requesting changes maintains invariants", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await requestChanges(submissionId, ctx.admin.id, "Please add more photos");

      const submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });

    void test("resubmitting after changes requested maintains invariants", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        changesRequested: true,
        changesRequestedBy: ctx.admin.id,
      });

      let submission = await getSubmissionById(submissionId);

      // Simulate resubmit (clear changes_requested fields, preserve witness AND submitted_on)
      await updateSubmission(submissionId, {
        changes_requested_on: null,
        changes_requested_by: null,
        changes_requested_reason: null,
        submitted_on: submission!.submitted_on, // Preserve original
      });

      submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });
  });

  void describe("Complex State Chains", () => {
    void test("full happy path: draft → submit → witness → approve", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: false,
      });

      // Step 1: Submit
      await updateSubmission(submissionId, {
        submitted_on: new Date().toISOString(),
        witness_verification_status: "pending",
      });
      let submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);

      // Step 2: Witness
      await confirmWitness(submissionId, ctx.admin.id);
      submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);

      // Step 3: Approve
      await approveSubmission(ctx.admin.id, submissionId, mockSpeciesIds, mockApprovalData);
      submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });

    void test("changes-requested workflow: submit → witness → request changes → resubmit → approve", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: false,
      });

      // Submit
      await updateSubmission(submissionId, {
        submitted_on: new Date().toISOString(),
        witness_verification_status: "pending",
      });
      let submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);

      // Witness
      await confirmWitness(submissionId, ctx.admin.id);
      submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);

      // Request changes
      await requestChanges(submissionId, ctx.admin.id, "Add photos");
      submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);

      // Resubmit (clear changes_requested, preserve witness AND original submitted_on)
      const currentWitnessStatus = submission!.witness_verification_status;
      const originalSubmittedOn = submission!.submitted_on;
      await updateSubmission(submissionId, {
        changes_requested_on: null,
        changes_requested_by: null,
        changes_requested_reason: null,
        witness_verification_status: currentWitnessStatus,
        submitted_on: originalSubmittedOn, // Preserve original submission timestamp
      });
      submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);

      // Finally approve
      await approveSubmission(ctx.admin.id, submissionId, mockSpeciesIds, mockApprovalData);
      submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });
  });
});
