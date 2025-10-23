import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import { confirmWitness, declineWitness, getSubmissionById } from "../db/submissions";
import { createMember, getMember } from "../db/members";

/**
 * Integration tests for witness queue operations
 * Tests state validation, self-witness prevention, and transaction integrity
 */

interface TestMember {
  id: number;
  display_name: string;
  contact_email: string;
}

void describe("Witness Queue Operations", () => {
  let db: Database;
  let testMember: TestMember;
  let witnessAdmin: TestMember;
  let otherAdmin: TestMember;

  // Helper to create test submission in specific state
  async function createTestSubmission(options: {
    memberId: number;
    submitted?: boolean;
    witnessStatus?: "pending" | "confirmed" | "declined";
    approved?: boolean;
    denied?: boolean;
  }): Promise<number> {
    const now = new Date().toISOString();
    const result = await db.run(
      `INSERT INTO submissions (
        member_id, species_class, species_type, species_common_name,
        species_latin_name, reproduction_date, temperature, ph, gh,
        water_type, witness_verification_status, program,
        submitted_on, approved_on, approved_by, points,
        denied_on, denied_by, denied_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        options.memberId,
        "Livebearers",
        "Fish",
        "Guppy",
        "Poecilia reticulata",
        now,
        "75",
        "7.0",
        "150",
        "Fresh",
        options.witnessStatus || "pending",
        "fish",
        options.submitted ? now : null,
        options.approved ? now : null,
        options.approved ? otherAdmin.id : null,
        options.approved ? 10 : null,
        options.denied ? now : null,
        options.denied ? otherAdmin.id : null,
        options.denied ? "Test denial reason" : null,
      ]
    );

    return result.lastID as number;
  }

  beforeEach(async () => {
    // Create fresh in-memory database for each test
    db = await open({
      filename: ":memory:",
      driver: sqlite3.Database,
    });

    // Disable foreign key constraints for simpler testing
    await db.exec("PRAGMA foreign_keys = OFF;");

    // Run migrations
    await db.migrate({
      migrationsPath: "./db/migrations",
    });

    // Override the global connection
    overrideConnection(db);

    // Create test users
    const memberEmail = `member-${Date.now()}@test.com`;
    const witnessEmail = `witness-${Date.now()}@test.com`;
    const adminEmail = `admin-${Date.now()}@test.com`;

    const memberId = await createMember(memberEmail, "Test Member");
    const witnessId = await createMember(witnessEmail, "Witness Admin");
    const adminId = await createMember(adminEmail, "Other Admin");

    testMember = (await getMember(memberId)) as TestMember;
    witnessAdmin = (await getMember(witnessId)) as TestMember;
    otherAdmin = (await getMember(adminId)) as TestMember;
  });

  afterEach(async () => {
    try {
      await db.close();
    } catch {
      // Ignore close errors in tests
    }
  });

  void describe("confirmWitness()", () => {
    void describe("Happy Path", () => {
      void test("should successfully confirm witness for pending submission", async () => {
        const submissionId = await createTestSubmission({
          memberId: testMember.id,
          submitted: true,
          witnessStatus: "pending",
        });

        await confirmWitness(submissionId, witnessAdmin.id);

        const submission = await getSubmissionById(submissionId);
        assert.strictEqual(submission?.witness_verification_status, "confirmed");
        assert.strictEqual(submission?.witnessed_by, witnessAdmin.id);
        assert.ok(submission?.witnessed_on !== null);
        assert.ok(new Date(submission.witnessed_on).getTime() > 0);
      });

      void test("should set witnessed_on timestamp", async () => {
        const beforeTime = Date.now();
        const submissionId = await createTestSubmission({
          memberId: testMember.id,
          submitted: true,
          witnessStatus: "pending",
        });

        await confirmWitness(submissionId, witnessAdmin.id);
        const afterTime = Date.now();

        const submission = await getSubmissionById(submissionId);
        const witnessedTime = new Date(submission!.witnessed_on!).getTime();

        assert.ok(witnessedTime >= beforeTime);
        assert.ok(witnessedTime <= afterTime);
      });
    });

    void describe("Self-Witness Prevention", () => {
      void test("should reject confirmation if admin is submission owner", async () => {
        const submissionId = await createTestSubmission({
          memberId: witnessAdmin.id, // Admin witnessing their own submission
          submitted: true,
          witnessStatus: "pending",
        });

        await assert.rejects(
          async () => await confirmWitness(submissionId, witnessAdmin.id),
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
        const submissionId = await createTestSubmission({
          memberId: testMember.id,
          submitted: true,
          witnessStatus: "confirmed",
        });

        await assert.rejects(
          async () => await confirmWitness(submissionId, witnessAdmin.id),
          /Submission not in pending witness state/
        );
      });

      void test("should reject confirmation if already declined", async () => {
        const submissionId = await createTestSubmission({
          memberId: testMember.id,
          submitted: true,
          witnessStatus: "declined",
        });

        await assert.rejects(
          async () => await confirmWitness(submissionId, witnessAdmin.id),
          /Submission not in pending witness state/
        );
      });

      void test("should reject confirmation if submission does not exist", async () => {
        const nonExistentId = 99999;

        await assert.rejects(
          async () => await confirmWitness(nonExistentId, witnessAdmin.id),
          /Submission not found/
        );
      });
    });

    void describe("Transaction Integrity", () => {
      void test("should detect concurrent state change", async () => {
        const submissionId = await createTestSubmission({
          memberId: testMember.id,
          submitted: true,
          witnessStatus: "pending",
        });

        // Simulate concurrent update by changing state directly
        await db.run(
          `UPDATE submissions SET witness_verification_status = 'confirmed' WHERE id = ?`,
          [submissionId]
        );

        // Should reject because state is no longer pending
        await assert.rejects(
          async () => await confirmWitness(submissionId, witnessAdmin.id),
          /Submission not in pending witness state/
        );
      });
    });
  });

  void describe("declineWitness()", () => {
    void describe("Happy Path", () => {
      void test("should successfully decline witness for pending submission", async () => {
        const submissionId = await createTestSubmission({
          memberId: testMember.id,
          submitted: true,
          witnessStatus: "pending",
        });

        await declineWitness(submissionId, witnessAdmin.id);

        const submission = await getSubmissionById(submissionId);
        assert.strictEqual(submission?.witness_verification_status, "declined");
        assert.strictEqual(submission?.witnessed_by, witnessAdmin.id);
        assert.ok(submission?.witnessed_on !== null);
      });

      void test("should set witnessed_on timestamp when declining", async () => {
        const beforeTime = Date.now();
        const submissionId = await createTestSubmission({
          memberId: testMember.id,
          submitted: true,
          witnessStatus: "pending",
        });

        await declineWitness(submissionId, witnessAdmin.id);
        const afterTime = Date.now();

        const submission = await getSubmissionById(submissionId);
        const witnessedTime = new Date(submission!.witnessed_on!).getTime();

        assert.ok(witnessedTime >= beforeTime);
        assert.ok(witnessedTime <= afterTime);
      });

      void test("should allow member to resubmit after decline", async () => {
        const submissionId = await createTestSubmission({
          memberId: testMember.id,
          submitted: true,
          witnessStatus: "pending",
        });

        await declineWitness(submissionId, witnessAdmin.id);

        // Verify submission can be updated (not blocked)
        await db.run(
          `UPDATE submissions SET
            witness_verification_status = 'pending',
            witnessed_by = NULL,
            witnessed_on = NULL
          WHERE id = ?`,
          [submissionId]
        );

        const submission = await getSubmissionById(submissionId);
        assert.strictEqual(submission?.witness_verification_status, "pending");
      });
    });

    void describe("Self-Witness Prevention", () => {
      void test("should reject decline if admin is submission owner", async () => {
        const submissionId = await createTestSubmission({
          memberId: witnessAdmin.id, // Admin declining their own submission
          submitted: true,
          witnessStatus: "pending",
        });

        await assert.rejects(
          async () => await declineWitness(submissionId, witnessAdmin.id),
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
        const submissionId = await createTestSubmission({
          memberId: testMember.id,
          submitted: true,
          witnessStatus: "confirmed",
        });

        await assert.rejects(
          async () => await declineWitness(submissionId, witnessAdmin.id),
          /Submission not in pending witness state/
        );
      });

      void test("should reject decline if already declined", async () => {
        const submissionId = await createTestSubmission({
          memberId: testMember.id,
          submitted: true,
          witnessStatus: "declined",
        });

        await assert.rejects(
          async () => await declineWitness(submissionId, witnessAdmin.id),
          /Submission not in pending witness state/
        );
      });

      void test("should reject decline if submission does not exist", async () => {
        const nonExistentId = 99999;

        await assert.rejects(
          async () => await declineWitness(nonExistentId, witnessAdmin.id),
          /Submission not found/
        );
      });
    });

    void describe("Transaction Integrity", () => {
      void test("should detect concurrent state change", async () => {
        const submissionId = await createTestSubmission({
          memberId: testMember.id,
          submitted: true,
          witnessStatus: "pending",
        });

        // Simulate concurrent update by changing state directly
        await db.run(
          `UPDATE submissions SET witness_verification_status = 'confirmed' WHERE id = ?`,
          [submissionId]
        );

        // Should reject because state is no longer pending
        await assert.rejects(
          async () => await declineWitness(submissionId, witnessAdmin.id),
          /Submission not in pending witness state/
        );
      });
    });
  });

  void describe("Witness Workflow Integration", () => {
    void test("should handle confirm -> decline workflow (member resubmits after decline)", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessStatus: "pending",
      });

      // First admin declines
      await declineWitness(submissionId, witnessAdmin.id);
      let submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.witness_verification_status, "declined");

      // Member fixes issues and resets to pending (simulated)
      await db.run(
        `UPDATE submissions SET
          witness_verification_status = 'pending',
          witnessed_by = NULL,
          witnessed_on = NULL
        WHERE id = ?`,
        [submissionId]
      );

      // Different admin confirms
      await confirmWitness(submissionId, otherAdmin.id);
      submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.witness_verification_status, "confirmed");
      assert.strictEqual(submission?.witnessed_by, otherAdmin.id);
    });

    void test("should allow different admin to witness after first admin declines", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessStatus: "pending",
      });

      // First admin declines
      await declineWitness(submissionId, witnessAdmin.id);

      // Reset to pending (member resubmits)
      await db.run(
        `UPDATE submissions SET
          witness_verification_status = 'pending',
          witnessed_by = NULL,
          witnessed_on = NULL
        WHERE id = ?`,
        [submissionId]
      );

      // Different admin confirms - should succeed
      await confirmWitness(submissionId, otherAdmin.id);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.witness_verification_status, "confirmed");
      assert.strictEqual(submission?.witnessed_by, otherAdmin.id);
    });

    void test("should maintain idempotency - cannot confirm twice", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessStatus: "pending",
      });

      // First confirmation succeeds
      await confirmWitness(submissionId, witnessAdmin.id);

      // Second confirmation should fail
      await assert.rejects(
        async () => await confirmWitness(submissionId, otherAdmin.id),
        /Submission not in pending witness state/
      );

      // Verify first witness is preserved
      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.witnessed_by, witnessAdmin.id);
    });
  });

  void describe("Edge Cases", () => {
    void test("should handle submission with no submitted_on (draft)", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: false, // Draft - not submitted
        witnessStatus: "pending",
      });

      // Should still prevent witnessing if in wrong state
      // (though in practice, drafts shouldn't be in witness queue)
      await confirmWitness(submissionId, witnessAdmin.id);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.witness_verification_status, "confirmed");
    });

    void test("should handle multiple admins witnessing different submissions", async () => {
      const submission1 = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessStatus: "pending",
      });

      const submission2 = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessStatus: "pending",
      });

      // Different admins witness different submissions
      await confirmWitness(submission1, witnessAdmin.id);
      await declineWitness(submission2, otherAdmin.id);

      const sub1 = await getSubmissionById(submission1);
      const sub2 = await getSubmissionById(submission2);

      assert.strictEqual(sub1?.witness_verification_status, "confirmed");
      assert.strictEqual(sub1?.witnessed_by, witnessAdmin.id);

      assert.strictEqual(sub2?.witness_verification_status, "declined");
      assert.strictEqual(sub2?.witnessed_by, otherAdmin.id);
    });
  });
});
