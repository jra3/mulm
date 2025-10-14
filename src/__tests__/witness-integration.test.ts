import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import { confirmWitness, declineWitness, getSubmissionById } from "../db/submissions";
import { createMember, getMember } from "../db/members";
import { getWaitingPeriodStatus } from "../utils/waitingPeriod";

// Mock the email notifications to prevent actual emails during tests
// Note: mock.module is not yet stable in Node test runner, so we skip this for now

interface TestSubmission {
  id: number;
  member_id: number;
  species_class: string;
  species_type: string;
  witness_verification_status: string;
}

interface TestMember {
  id: number;
  display_name: string;
  contact_email: string;
}

describe("Witness Workflow Integration Tests", () => {
  let db: Database;
  let testMember: TestMember;
  let admin1: TestMember;
  let admin2: TestMember;
  let admin3: TestMember;

  // Helper function to create a test submission
  async function createTestSubmission(
    memberId: number,
    speciesType: string = "Fish",
    speciesClass: string = "New World",
    status: string = "pending"
  ): Promise<number> {
    const result = await db.run(
      `
			INSERT INTO submissions (
				member_id, species_class, species_type, species_common_name,
				species_latin_name, reproduction_date, temperature, ph, gh,
				specific_gravity, water_type, witness_verification_status,
				program, submitted_on
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
      [
        memberId,
        speciesClass,
        speciesType,
        "Test Fish",
        "Testus fishus",
        new Date().toISOString(),
        "75",
        "7.0",
        "10",
        "1.000",
        "Fresh",
        status,
        speciesType.toLowerCase(),
        new Date().toISOString(),
      ]
    );

    return result.lastID as number;
  }

  // Helper to get submission details
  async function getSubmissionDetails(submissionId: number): Promise<TestSubmission> {
    const result = await db.get<TestSubmission>(
      `
			SELECT id, member_id, species_class, species_type, witness_verification_status
			FROM submissions WHERE id = ?
		`,
      submissionId
    );
    return result as TestSubmission;
  }

  // Helper to create multiple submissions for testing
  async function createMultipleSubmissions(count: number, memberId: number): Promise<number[]> {
    const submissions: number[] = [];
    for (let i = 0; i < count; i++) {
      const id = await createTestSubmission(memberId, "Fish", "New World");
      submissions.push(id);
    }
    return submissions;
  }

  beforeEach(async () => {
    // Create fresh in-memory database for each test
    db = await open({
      filename: ":memory:",
      driver: sqlite3.Database,
    });

    // Enable foreign key constraints
    await db.exec("PRAGMA foreign_keys = ON;");

    // Run migrations
    await db.migrate({
      migrationsPath: "./db/migrations",
    });

    // Override the global connection
    overrideConnection(db);

    // Create test users
    const memberEmail = `member-${Date.now()}@test.com`;
    const admin1Email = `admin1-${Date.now()}@test.com`;
    const admin2Email = `admin2-${Date.now()}@test.com`;
    const admin3Email = `admin3-${Date.now()}@test.com`;

    const memberId = await createMember(memberEmail, "Test Member");
    const admin1Id = await createMember(admin1Email, "Admin One");
    const admin2Id = await createMember(admin2Email, "Admin Two");
    const admin3Id = await createMember(admin3Email, "Admin Three");

    testMember = (await getMember(memberId)) as TestMember;
    admin1 = (await getMember(admin1Id)) as TestMember;
    admin2 = (await getMember(admin2Id)) as TestMember;
    admin3 = (await getMember(admin3Id)) as TestMember;
  });

  afterEach(async () => {
    try {
      await db.close();
    } catch {
      // Ignore close errors in tests
    }
  });

  describe("Basic Witness Operations", () => {
    test("should successfully confirm witness", async () => {
      const submissionId = await createTestSubmission(testMember.id);

      await confirmWitness(submissionId, admin1.id);

      const submission = await getSubmissionDetails(submissionId);
      assert.strictEqual(submission.witness_verification_status, "confirmed");

      const fullSubmission = await getSubmissionById(submissionId);
      assert.strictEqual(fullSubmission?.witnessed_by, admin1.id);
      assert.ok(fullSubmission?.witnessed_on !== undefined);
    });

    test("should successfully decline witness", async () => {
      const submissionId = await createTestSubmission(testMember.id);

      await declineWitness(submissionId, admin1.id);

      const submission = await getSubmissionDetails(submissionId);
      assert.strictEqual(submission.witness_verification_status, "declined");

      const fullSubmission = await getSubmissionById(submissionId);
      assert.strictEqual(fullSubmission?.witnessed_by, admin1.id);
      assert.ok(fullSubmission?.witnessed_on !== undefined);
    });

    test("should prevent self-witnessing on confirm", async () => {
      const submissionId = await createTestSubmission(testMember.id);

      await assert.rejects(
        async () => await confirmWitness(submissionId, testMember.id),
        /Cannot witness your own submission/
      );

      const submission = await getSubmissionDetails(submissionId);
      assert.strictEqual(submission.witness_verification_status, "pending");
    });

    test("should prevent self-witnessing on decline", async () => {
      const submissionId = await createTestSubmission(testMember.id);

      await assert.rejects(
        async () => await declineWitness(submissionId, testMember.id),
        /Cannot witness your own submission/
      );

      const submission = await getSubmissionDetails(submissionId);
      assert.strictEqual(submission.witness_verification_status, "pending");
    });

    test("should reject non-existent submission", async () => {
      const nonExistentId = 99999;

      await assert.rejects(
        async () => await confirmWitness(nonExistentId, admin1.id),
        /Submission not found/
      );

      await assert.rejects(
        async () => await declineWitness(nonExistentId, admin1.id),
        /Submission not found/
      );
    });

    test("should reject non-existent admin", async () => {
      const submissionId = await createTestSubmission(testMember.id);
      const nonExistentAdminId = 99999;

      // These should fail at the database level due to foreign key constraints
      await assert.rejects(async () => await confirmWitness(submissionId, nonExistentAdminId));

      await assert.rejects(async () => await declineWitness(submissionId, nonExistentAdminId));
    });
  });

  describe("State Transition Validation", () => {
    test("should prevent confirming already confirmed submission", async () => {
      const submissionId = await createTestSubmission(testMember.id);

      await confirmWitness(submissionId, admin1.id);

      await assert.rejects(
        async () => await confirmWitness(submissionId, admin2.id),
        /Submission not in pending witness state/
      );
    });

    test("should prevent declining already confirmed submission", async () => {
      const submissionId = await createTestSubmission(testMember.id);

      await confirmWitness(submissionId, admin1.id);

      await assert.rejects(
        async () => await declineWitness(submissionId, admin2.id),
        /Submission not in pending witness state/
      );
    });

    test("should prevent confirming already declined submission", async () => {
      const submissionId = await createTestSubmission(testMember.id);

      await declineWitness(submissionId, admin1.id);

      await assert.rejects(
        async () => await confirmWitness(submissionId, admin2.id),
        /Submission not in pending witness state/
      );
    });

    test("should prevent declining already declined submission", async () => {
      const submissionId = await createTestSubmission(testMember.id);

      await declineWitness(submissionId, admin1.id);

      await assert.rejects(
        async () => await declineWitness(submissionId, admin2.id),
        /Submission not in pending witness state/
      );
    });

    test("should only allow witnessing submissions in pending state", async () => {
      // Test with pre-confirmed submission
      const confirmedId = await createTestSubmission(
        testMember.id,
        "Fish",
        "New World",
        "confirmed"
      );

      await assert.rejects(
        async () => await confirmWitness(confirmedId, admin1.id),
        /Submission not in pending witness state/
      );

      await assert.rejects(
        async () => await declineWitness(confirmedId, admin1.id),
        /Submission not in pending witness state/
      );

      // Test with pre-declined submission
      const declinedId = await createTestSubmission(testMember.id, "Fish", "New World", "declined");

      await assert.rejects(
        async () => await confirmWitness(declinedId, admin1.id),
        /Submission not in pending witness state/
      );

      await assert.rejects(
        async () => await declineWitness(declinedId, admin1.id),
        /Submission not in pending witness state/
      );
    });
  });

  describe("Race Condition & Concurrency Tests", () => {
    test("should handle concurrent confirm attempts correctly", async () => {
      const submissionId = await createTestSubmission(testMember.id);

      // Start both operations simultaneously
      const promise1 = confirmWitness(submissionId, admin1.id);
      const promise2 = confirmWitness(submissionId, admin2.id);

      const results = await Promise.allSettled([promise1, promise2]);

      // Exactly one should succeed, one should fail
      const succeeded = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");

      assert.strictEqual(succeeded.length, 1);
      assert.strictEqual(failed.length, 1);

      // Check final state
      const submission = await getSubmissionDetails(submissionId);
      assert.strictEqual(submission.witness_verification_status, "confirmed");

      const fullSubmission = await getSubmissionById(submissionId);
      assert.ok([admin1.id, admin2.id].includes(fullSubmission?.witnessed_by));
    });

    test("should handle concurrent decline attempts correctly", async () => {
      const submissionId = await createTestSubmission(testMember.id);

      const promise1 = declineWitness(submissionId, admin1.id);
      const promise2 = declineWitness(submissionId, admin2.id);

      const results = await Promise.allSettled([promise1, promise2]);

      const succeeded = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");

      assert.strictEqual(succeeded.length, 1);
      assert.strictEqual(failed.length, 1);

      const submission = await getSubmissionDetails(submissionId);
      assert.strictEqual(submission.witness_verification_status, "declined");
    });

    test("should handle mixed concurrent operations (confirm vs decline)", async () => {
      const submissionId = await createTestSubmission(testMember.id);

      const confirmPromise = confirmWitness(submissionId, admin1.id);
      const declinePromise = declineWitness(submissionId, admin2.id);

      const results = await Promise.allSettled([confirmPromise, declinePromise]);

      const succeeded = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");

      assert.strictEqual(succeeded.length, 1);
      assert.strictEqual(failed.length, 1);

      const submission = await getSubmissionDetails(submissionId);
      assert.ok(["confirmed", "declined"].includes(submission.witness_verification_status));
    });

    test("should handle high concurrency scenarios", async () => {
      const submissionId = await createTestSubmission(testMember.id);

      // Create 10 concurrent operations
      const promises = Array.from({ length: 10 }, (_, i) => {
        const adminId = i % 2 === 0 ? admin1.id : admin2.id;
        const operation = i % 3 === 0 ? declineWitness : confirmWitness;
        return operation(submissionId, adminId);
      });

      const results = await Promise.allSettled(promises);

      // Exactly one should succeed
      const succeeded = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");

      assert.strictEqual(succeeded.length, 1);
      assert.strictEqual(failed.length, 9);

      // Check final state is valid
      const submission = await getSubmissionDetails(submissionId);
      assert.ok(["confirmed", "declined"].includes(submission.witness_verification_status));
    });
  });

  describe("Data Integrity & Foreign Key Tests", () => {
    test("should maintain referential integrity for witnessed_by", async () => {
      const submissionId = await createTestSubmission(testMember.id);

      await confirmWitness(submissionId, admin1.id);

      // Verify the foreign key relationship
      const result = await db.get<{ id: number; witnessed_by: number; display_name: string }>(
        `
				SELECT s.id, s.witnessed_by, m.display_name 
				FROM submissions s 
				JOIN members m ON s.witnessed_by = m.id 
				WHERE s.id = ?
			`,
        submissionId
      );

      assert.strictEqual(result?.witnessed_by, admin1.id);
      assert.strictEqual(result?.display_name, admin1.display_name);
    });

    test("should handle member deletion with ON DELETE SET NULL", async () => {
      const submissionId = await createTestSubmission(testMember.id);

      await confirmWitness(submissionId, admin1.id);

      // Delete the admin (this should set witnessed_by to NULL due to ON DELETE SET NULL)
      await db.run("DELETE FROM members WHERE id = ?", admin1.id);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.witnessed_by, null);
      assert.strictEqual(submission?.witness_verification_status, "confirmed"); // Status should remain
    });

    test("should maintain transaction atomicity on failure", async () => {
      const submissionId = await createTestSubmission(testMember.id);

      // Mock a database error during the transaction
      const originalPrepare = db.prepare.bind(db);
      let callCount = 0;

      db.prepare = (sql: string) => {
        callCount++;
        if (callCount === 2 && sql.includes("UPDATE")) {
          throw new Error("Simulated database error");
        }
        return originalPrepare(sql);
      };

      await assert.rejects(async () => await confirmWitness(submissionId, admin1.id));

      // Submission should remain in pending state
      const submission = await getSubmissionDetails(submissionId);
      assert.strictEqual(submission.witness_verification_status, "pending");

      // Restore original function
      db.prepare = originalPrepare;
    });
  });

  describe("Waiting Period Integration", () => {
    test("should integrate with waiting period calculations for freshwater fish", async () => {
      const submissionId = await createTestSubmission(testMember.id, "Fish", "New World");

      await confirmWitness(submissionId, admin1.id);

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission !== undefined);

      const waitingStatus = getWaitingPeriodStatus(submission!);
      assert.strictEqual(waitingStatus.requiredDays, 60); // Non-marine fish should be 60 days
      assert.strictEqual(waitingStatus.eligible, false); // Should not be eligible yet
    });

    test("should integrate with waiting period calculations for marine fish", async () => {
      const submissionId = await createTestSubmission(testMember.id, "Fish", "Marine");

      await confirmWitness(submissionId, admin1.id);

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission !== undefined);

      const waitingStatus = getWaitingPeriodStatus(submission!);
      assert.strictEqual(waitingStatus.requiredDays, 30); // Marine fish should be 30 days
    });

    test("should integrate with waiting period calculations for plants", async () => {
      const submissionId = await createTestSubmission(testMember.id, "Plant", "Anubius");

      await confirmWitness(submissionId, admin1.id);

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission !== undefined);

      const waitingStatus = getWaitingPeriodStatus(submission!);
      assert.strictEqual(waitingStatus.requiredDays, 60); // Plants should be 60 days
    });

    test("should not affect waiting period for declined submissions", async () => {
      const submissionId = await createTestSubmission(testMember.id, "Fish", "New World");

      await declineWitness(submissionId, admin1.id);

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission !== undefined);

      const waitingStatus = getWaitingPeriodStatus(submission!);
      assert.strictEqual(waitingStatus.eligible, false); // Declined submissions should not be eligible
    });
  });

  describe("Bulk Operations & Performance", () => {
    // Tests removed - SQLite doesn't support concurrent transactions
    // The important concurrency test is "should handle high concurrency scenarios"
    // which tests race conditions using Promise.allSettled
  });

  describe("Error Handling & Edge Cases", () => {
    test("should handle zero and negative submission IDs gracefully", async () => {
      await assert.rejects(async () => await confirmWitness(0, admin1.id), /Submission not found/);

      await assert.rejects(async () => await confirmWitness(-1, admin1.id), /Submission not found/);

      await assert.rejects(async () => await declineWitness(0, admin1.id), /Submission not found/);

      await assert.rejects(async () => await declineWitness(-1, admin1.id), /Submission not found/);
    });

    test("should handle extremely large IDs gracefully", async () => {
      const largeId = Number.MAX_SAFE_INTEGER;

      await assert.rejects(
        async () => await confirmWitness(largeId, admin1.id),
        /Submission not found/
      );

      await assert.rejects(
        async () => await declineWitness(largeId, admin1.id),
        /Submission not found/
      );
    });

    test("should preserve original error messages", async () => {
      const submissionId = await createTestSubmission(testMember.id);

      // Self-witnessing should preserve specific error message
      try {
        await confirmWitness(submissionId, testMember.id);
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.strictEqual((error as Error).message, "Cannot witness your own submission");
      }

      // Already witnessed should preserve specific error message
      await confirmWitness(submissionId, admin1.id);

      try {
        await confirmWitness(submissionId, admin2.id);
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.strictEqual((error as Error).message, "Submission not in pending witness state");
      }
    });
  });

  describe("Real-world Workflow Scenarios", () => {
    test("should handle complete workflow: submission → witness → waiting period", async () => {
      // Create submission
      const submissionId = await createTestSubmission(testMember.id, "Fish", "Marine");

      // Initial state check
      let submission = await getSubmissionDetails(submissionId);
      assert.strictEqual(submission.witness_verification_status, "pending");

      // Witness confirmation
      await confirmWitness(submissionId, admin1.id);

      // Check witnessed state
      submission = await getSubmissionDetails(submissionId);
      assert.strictEqual(submission.witness_verification_status, "confirmed");

      // Check waiting period integration
      const fullSubmission = await getSubmissionById(submissionId);
      const waitingStatus = getWaitingPeriodStatus(fullSubmission!);
      assert.strictEqual(waitingStatus.requiredDays, 30); // Marine fish
      assert.ok(waitingStatus.elapsedDays >= 0);
    });

    test("should handle admin managing multiple member submissions", async () => {
      // Create second member
      const member2Id = await createMember("member2@test.com", "Member Two");

      // Create submissions from different members
      const submission1 = await createTestSubmission(testMember.id);
      const submission2 = await createTestSubmission(member2Id);
      const submission3 = await createTestSubmission(testMember.id);

      // Admin witnesses all submissions
      await confirmWitness(submission1, admin1.id);
      await confirmWitness(submission2, admin1.id);
      await declineWitness(submission3, admin1.id);

      // Verify all operations completed correctly
      const sub1 = await getSubmissionDetails(submission1);
      const sub2 = await getSubmissionDetails(submission2);
      const sub3 = await getSubmissionDetails(submission3);

      assert.strictEqual(sub1.witness_verification_status, "confirmed");
      assert.strictEqual(sub2.witness_verification_status, "confirmed");
      assert.strictEqual(sub3.witness_verification_status, "declined");
    });
  });
});
