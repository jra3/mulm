import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { confirmWitness, declineWitness, getSubmissionById } from "../db/submissions";
import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestSubmission,
  type TestContext,
} from "./helpers/testHelpers";

/**
 * Integration tests for witness queue operations
 * Tests state validation, self-witness prevention, and transaction integrity
 */

void describe("Witness Queue Operations", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase({ adminCount: 2 }); // Need 2 admins for some tests
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void describe("confirmWitness()", () => {
    void describe("Happy Path", () => {
      void test("should successfully confirm witness for pending submission", async () => {
        const submissionId = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
        });

        await confirmWitness(submissionId, ctx.admin.id);

        const submission = await getSubmissionById(submissionId);
        assert.strictEqual(submission?.witness_verification_status, "confirmed");
        assert.strictEqual(submission?.witnessed_by, ctx.admin.id);
        assert.ok(submission?.witnessed_on !== null);
        assert.ok(new Date(submission.witnessed_on).getTime() > 0);
      });

      void test("should set witnessed_on timestamp", async () => {
        const beforeTime = Date.now();
        const submissionId = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
        });

        await confirmWitness(submissionId, ctx.admin.id);
        const afterTime = Date.now();

        const submission = await getSubmissionById(submissionId);
        const witnessedTime = new Date(submission!.witnessed_on!).getTime();

        assert.ok(witnessedTime >= beforeTime);
        assert.ok(witnessedTime <= afterTime);
      });
    });

    void describe("Self-Witness Prevention", () => {
      void test("should reject confirmation if admin is submission owner", async () => {
        const submissionId = await createTestSubmission(ctx.db, {
          memberId: ctx.admin.id, // Admin witnessing their own submission
          submitted: true,
        });

        await assert.rejects(
          async () => await confirmWitness(submissionId, ctx.admin.id),
          /Cannot witness your own submission/
        );

        // Verify submission remains unchanged
        const submission = await getSubmissionById(submissionId);
        assert.strictEqual(submission?.witness_verification_status, "pending");
        assert.strictEqual(submission?.witnessed_by, null);
        assert.strictEqual(submission?.witnessed_on, null);
      });
    });

    void describe("State Validation", () => {
      void test("should reject confirmation if already confirmed", async () => {
        const submissionId = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
          witnessStatus: "confirmed",
          witnessedBy: ctx.admin.id,
        });

        await assert.rejects(
          async () => await confirmWitness(submissionId, ctx.admin.id),
          /Submission not in pending witness state/
        );
      });

      void test("should reject confirmation if already declined", async () => {
        const submissionId = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
          witnessStatus: "declined",
          witnessedBy: ctx.admin.id,
        });

        await assert.rejects(
          async () => await confirmWitness(submissionId, ctx.admin.id),
          /Submission not in pending witness state/
        );
      });

      void test("should reject confirmation if submission does not exist", async () => {
        const nonExistentId = 99999;

        await assert.rejects(
          async () => await confirmWitness(nonExistentId, ctx.admin.id),
          /Submission not found/
        );
      });
    });

    void describe("Transaction Integrity", () => {
      void test("should detect concurrent state change", async () => {
        const submissionId = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
        });

        // First admin confirms
        await confirmWitness(submissionId, ctx.admin.id);

        // Second admin tries to confirm (should fail)
        await assert.rejects(
          async () => await confirmWitness(submissionId, ctx.otherAdmin!.id),
          /Submission not in pending witness state/
        );
      });
    });
  });

  void describe("declineWitness()", () => {
    void describe("Happy Path", () => {
      void test("should successfully decline witness for pending submission", async () => {
        const submissionId = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
        });

        await declineWitness(submissionId, ctx.admin.id);

        const submission = await getSubmissionById(submissionId);
        assert.strictEqual(submission?.witness_verification_status, "declined");
        assert.strictEqual(submission?.witnessed_by, ctx.admin.id);
        assert.ok(submission?.witnessed_on !== null);
      });

      void test("should set witnessed_on timestamp when declining", async () => {
        const beforeTime = Date.now();
        const submissionId = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
        });

        await declineWitness(submissionId, ctx.admin.id);
        const afterTime = Date.now();

        const submission = await getSubmissionById(submissionId);
        const witnessedTime = new Date(submission!.witnessed_on!).getTime();

        assert.ok(witnessedTime >= beforeTime);
        assert.ok(witnessedTime <= afterTime);
      });

      void test("should allow member to resubmit after decline", async () => {
        const submissionId = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
        });

        await declineWitness(submissionId, ctx.admin.id);

        let submission = await getSubmissionById(submissionId);
        assert.strictEqual(submission?.witness_verification_status, "declined");

        // Member can resubmit (reset witness status to pending)
        await ctx.db.run(
          "UPDATE submissions SET witness_verification_status = ? WHERE id = ?",
          ["pending", submissionId]
        );

        submission = await getSubmissionById(submissionId);
        assert.strictEqual(submission?.witness_verification_status, "pending");
      });
    });

    void describe("Self-Witness Prevention", () => {
      void test("should reject decline if admin is submission owner", async () => {
        const submissionId = await createTestSubmission(ctx.db, {
          memberId: ctx.admin.id, // Admin declining their own submission
          submitted: true,
        });

        await assert.rejects(
          async () => await declineWitness(submissionId, ctx.admin.id),
          /Cannot witness your own submission/
        );

        // Verify submission remains unchanged
        const submission = await getSubmissionById(submissionId);
        assert.strictEqual(submission?.witness_verification_status, "pending");
        assert.strictEqual(submission?.witnessed_by, null);
        assert.strictEqual(submission?.witnessed_on, null);
      });
    });

    void describe("State Validation", () => {
      void test("should reject decline if already confirmed", async () => {
        const submissionId = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
          witnessStatus: "confirmed",
          witnessedBy: ctx.admin.id,
        });

        await assert.rejects(
          async () => await declineWitness(submissionId, ctx.admin.id),
          /Submission not in pending witness state/
        );
      });

      void test("should reject decline if already declined", async () => {
        const submissionId = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
          witnessStatus: "declined",
          witnessedBy: ctx.admin.id,
        });

        await assert.rejects(
          async () => await declineWitness(submissionId, ctx.admin.id),
          /Submission not in pending witness state/
        );
      });

      void test("should reject decline if submission does not exist", async () => {
        const nonExistentId = 99999;

        await assert.rejects(
          async () => await declineWitness(nonExistentId, ctx.admin.id),
          /Submission not found/
        );
      });
    });

    void describe("Transaction Integrity", () => {
      void test("should detect concurrent state change", async () => {
        const submissionId = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
        });

        // First admin declines
        await declineWitness(submissionId, ctx.admin.id);

        // Second admin tries to decline (should fail)
        await assert.rejects(
          async () => await declineWitness(submissionId, ctx.otherAdmin!.id),
          /Submission not in pending witness state/
        );
      });
    });
  });

  void describe("Witness Workflow Integration", () => {
    void test("should handle confirm -> decline workflow (member resubmits after decline)", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
      });

      // First admin declines
      await declineWitness(submissionId, ctx.admin.id);
      let submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.witness_verification_status, "declined");

      // Member resubmits (reset to pending)
      await ctx.db.run(
        "UPDATE submissions SET witness_verification_status = ? WHERE id = ?",
        ["pending", submissionId]
      );

      // Different admin can now confirm
      await confirmWitness(submissionId, ctx.otherAdmin!.id);
      submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.witness_verification_status, "confirmed");
      assert.strictEqual(submission?.witnessed_by, ctx.otherAdmin!.id);
    });

    void test("should allow different admin to witness after first admin declines", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
      });

      // First admin declines
      await declineWitness(submissionId, ctx.admin.id);

      // Reset to pending (simulating member resubmit)
      await ctx.db.run(
        "UPDATE submissions SET witness_verification_status = ? WHERE id = ?",
        ["pending", submissionId]
      );

      // Second admin confirms
      await confirmWitness(submissionId, ctx.otherAdmin!.id);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.witness_verification_status, "confirmed");
      assert.strictEqual(submission?.witnessed_by, ctx.otherAdmin!.id);
    });

    void test("should maintain idempotency - cannot confirm twice", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
      });

      await confirmWitness(submissionId, ctx.admin.id);

      // Try to confirm again (should fail)
      await assert.rejects(
        async () => await confirmWitness(submissionId, ctx.admin.id),
        /Submission not in pending witness state/
      );
    });
  });

  void describe("Edge Cases", () => {
    void test("should handle submission with no submitted_on (draft)", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: false,
      });

      await assert.rejects(
        async () => await confirmWitness(submissionId, ctx.admin.id),
        /Submission not in pending witness state/
      );
    });

    void test("should handle multiple admins witnessing different submissions", async () => {
      const submission1 = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
      });

      const submission2 = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
      });

      // Different admins witness different submissions
      await confirmWitness(submission1, ctx.admin.id);
      await confirmWitness(submission2, ctx.otherAdmin!.id);

      const sub1 = await getSubmissionById(submission1);
      const sub2 = await getSubmissionById(submission2);

      assert.strictEqual(sub1?.witnessed_by, ctx.admin.id);
      assert.strictEqual(sub2?.witnessed_by, ctx.otherAdmin!.id);
    });
  });
});
