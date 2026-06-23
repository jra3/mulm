import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  setFinalSubmission,
  clearFinalSubmission,
  getSubmissionById,
  getOutstandingSubmissions,
} from "../db/submissions";
import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestSubmission,
  type TestContext,
} from "./helpers/testHelpers";

/**
 * Tests for the manual final-submission step that gates the admin approval
 * queue. After the waiting period elapses, a submission must have
 * final_submission_on set (via the submitter or an admin clicking a button)
 * before it shows up in the approval queue.
 */

const SIXTY_FIVE_DAYS_AGO = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000).toISOString();
const TEN_DAYS_AGO = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

void describe("Final Submission (Manual Approval Queue Gating)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase({ adminCount: 2 });
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void describe("setFinalSubmission()", () => {
    void test("owner can mark a confirmed past-waiting-period submission as final-submitted", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        reproductionDate: SIXTY_FIVE_DAYS_AGO,
      });

      await setFinalSubmission(submissionId, ctx.member.id, false);

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission?.final_submission_on, "final_submission_on should be set");
    });

    void test("admin can mark on submitter's behalf", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        reproductionDate: SIXTY_FIVE_DAYS_AGO,
      });

      await setFinalSubmission(submissionId, ctx.admin.id, true);

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission?.final_submission_on);
    });

    void test("non-owner non-admin is rejected", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        reproductionDate: SIXTY_FIVE_DAYS_AGO,
      });

      await assert.rejects(
        async () => await setFinalSubmission(submissionId, 99999, false),
        /Cannot modify another member's submission/
      );

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.final_submission_on, null);
    });

    void test("rejects when waiting period has not elapsed", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        reproductionDate: TEN_DAYS_AGO,
      });

      await assert.rejects(
        async () => await setFinalSubmission(submissionId, ctx.member.id, false),
        /Waiting period has not elapsed/
      );
    });

    void test("rejects when witness status is still pending", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "pending",
        reproductionDate: SIXTY_FIVE_DAYS_AGO,
      });

      await assert.rejects(
        async () => await setFinalSubmission(submissionId, ctx.member.id, false),
        /Submission has not been screened/
      );
    });

    void test("rejects when submission is still a draft", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: false,
        reproductionDate: SIXTY_FIVE_DAYS_AGO,
      });

      await assert.rejects(
        async () => await setFinalSubmission(submissionId, ctx.member.id, false),
        /Submission is still a draft/
      );
    });

    void test("rejects when submission is already approved", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        approved: true,
        approvedBy: ctx.admin.id,
        reproductionDate: SIXTY_FIVE_DAYS_AGO,
      });

      await assert.rejects(
        async () => await setFinalSubmission(submissionId, ctx.member.id, false),
        /Submission already approved/
      );
    });

    void test("is idempotent - calling twice does not change timestamp", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        reproductionDate: SIXTY_FIVE_DAYS_AGO,
      });

      await setFinalSubmission(submissionId, ctx.member.id, false);
      const first = await getSubmissionById(submissionId);
      const firstTs = first?.final_submission_on;

      await setFinalSubmission(submissionId, ctx.member.id, false);
      const second = await getSubmissionById(submissionId);

      assert.strictEqual(second?.final_submission_on, firstTs);
    });
  });

  void describe("clearFinalSubmission()", () => {
    void test("owner can un-queue an unapproved submission", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        reproductionDate: SIXTY_FIVE_DAYS_AGO,
      });

      await setFinalSubmission(submissionId, ctx.member.id, false);
      await clearFinalSubmission(submissionId, ctx.member.id, false);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.final_submission_on, null);
    });

    void test("rejects when submission is already approved", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        approved: true,
        approvedBy: ctx.admin.id,
        reproductionDate: SIXTY_FIVE_DAYS_AGO,
      });

      await assert.rejects(
        async () => await clearFinalSubmission(submissionId, ctx.member.id, false),
        /Submission already approved/
      );
    });

    void test("non-owner non-admin is rejected", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        reproductionDate: SIXTY_FIVE_DAYS_AGO,
      });
      await setFinalSubmission(submissionId, ctx.member.id, false);

      await assert.rejects(
        async () => await clearFinalSubmission(submissionId, 99999, false),
        /Cannot modify another member's submission/
      );

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission?.final_submission_on);
    });
  });

  void describe("Approval queue gating", () => {
    void test("submissions past waiting period without final_submission_on are NOT in the queue", async () => {
      await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        reproductionDate: SIXTY_FIVE_DAYS_AGO,
      });

      const queue = await getOutstandingSubmissions("fish");
      assert.strictEqual(queue.length, 0, "queue should be empty until submitter clicks the button");
    });

    void test("submissions appear in the queue once final_submission_on is set", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        reproductionDate: SIXTY_FIVE_DAYS_AGO,
      });

      await setFinalSubmission(submissionId, ctx.member.id, false);

      const queue = await getOutstandingSubmissions("fish");
      assert.strictEqual(queue.length, 1);
      assert.strictEqual(queue[0].id, submissionId);
    });

    void test("clearing final_submission_on removes the submission from the queue", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
        reproductionDate: SIXTY_FIVE_DAYS_AGO,
      });

      await setFinalSubmission(submissionId, ctx.member.id, false);
      await clearFinalSubmission(submissionId, ctx.member.id, false);

      const queue = await getOutstandingSubmissions("fish");
      assert.strictEqual(queue.length, 0);
    });
  });
});
