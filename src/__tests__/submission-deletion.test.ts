import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import { deleteSubmissionWithAuth, getSubmissionById } from "../db/submissions";
import { createMember, getMember } from "../db/members";

/**
 * Integration tests for submission deletion authorization
 * Tests that deletions are properly authorized based on ownership and approval state
 */

interface TestMember {
  id: number;
  display_name: string;
  contact_email: string;
}

void describe("Submission Deletion - Authorization", () => {
  let db: Database;
  let member1: TestMember;
  let member2: TestMember;
  let admin: TestMember;

  // Helper to create test submission
  async function createTestSubmission(options: {
    memberId: number;
    submitted?: boolean;
    approved?: boolean;
  }): Promise<number> {
    const now = new Date().toISOString();
    const result = await db.run(
      `INSERT INTO submissions (
        member_id, species_class, species_type, species_common_name,
        species_latin_name, reproduction_date, temperature, ph, gh,
        water_type, witness_verification_status, program,
        submitted_on, approved_on, approved_by, points
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        "pending",
        "fish",
        options.submitted ? now : null,
        options.approved ? now : null,
        options.approved ? admin.id : null,
        options.approved ? 10 : null,
      ]
    );

    return result.lastID as number;
  }

  beforeEach(async () => {
    db = await open({
      filename: ":memory:",
      driver: sqlite3.Database,
    });

    await db.exec("PRAGMA foreign_keys = OFF;");
    await db.migrate({ migrationsPath: "./db/migrations" });
    overrideConnection(db);

    const member1Email = `member1-${Date.now()}@test.com`;
    const member2Email = `member2-${Date.now()}@test.com`;
    const adminEmail = `admin-${Date.now()}@test.com`;

    const member1Id = await createMember(member1Email, "Member One");
    const member2Id = await createMember(member2Email, "Member Two");
    const adminId = await createMember(adminEmail, "Test Admin");

    member1 = (await getMember(member1Id)) as TestMember;
    member2 = (await getMember(member2Id)) as TestMember;
    admin = (await getMember(adminId)) as TestMember;
  });

  afterEach(async () => {
    try {
      await db.close();
    } catch {
      // Ignore
    }
  });

  void describe("Owner Deletion", () => {
    void test("should allow owner to delete draft submission", async () => {
      const submissionId = await createTestSubmission({
        memberId: member1.id,
        submitted: false,
      });

      await deleteSubmissionWithAuth(submissionId, member1.id, false);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission, undefined);
    });

    void test("should allow owner to delete submitted (unapproved) submission", async () => {
      const submissionId = await createTestSubmission({
        memberId: member1.id,
        submitted: true,
        approved: false,
      });

      await deleteSubmissionWithAuth(submissionId, member1.id, false);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission, undefined);
    });

    void test("should REJECT owner deletion of approved submission", async () => {
      const submissionId = await createTestSubmission({
        memberId: member1.id,
        submitted: true,
        approved: true,
      });

      await assert.rejects(
        async () => await deleteSubmissionWithAuth(submissionId, member1.id, false),
        /Cannot delete approved submissions/
      );

      // Verify submission still exists
      const submission = await getSubmissionById(submissionId);
      assert.ok(submission !== undefined);
    });
  });

  void describe("Non-Owner Deletion", () => {
    void test("should REJECT non-owner deletion attempt", async () => {
      const submissionId = await createTestSubmission({
        memberId: member1.id,
        submitted: false,
      });

      await assert.rejects(
        async () => await deleteSubmissionWithAuth(submissionId, member2.id, false),
        /Cannot delete another member's submission/
      );

      // Verify submission still exists
      const submission = await getSubmissionById(submissionId);
      assert.ok(submission !== undefined);
    });
  });

  void describe("Admin Deletion", () => {
    void test("should allow admin to delete draft submission", async () => {
      const submissionId = await createTestSubmission({
        memberId: member1.id,
        submitted: false,
      });

      await deleteSubmissionWithAuth(submissionId, admin.id, true);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission, undefined);
    });

    void test("should allow admin to delete submitted submission", async () => {
      const submissionId = await createTestSubmission({
        memberId: member1.id,
        submitted: true,
      });

      await deleteSubmissionWithAuth(submissionId, admin.id, true);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission, undefined);
    });

    void test("should allow admin to delete APPROVED submission (admin override)", async () => {
      const submissionId = await createTestSubmission({
        memberId: member1.id,
        submitted: true,
        approved: true,
      });

      await deleteSubmissionWithAuth(submissionId, admin.id, true);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission, undefined);
    });

    void test("should allow admin to delete another member's submission", async () => {
      const submissionId = await createTestSubmission({
        memberId: member1.id,
        submitted: true,
      });

      await deleteSubmissionWithAuth(submissionId, admin.id, true);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission, undefined);
    });
  });

  void describe("Edge Cases", () => {
    void test("should reject deletion of non-existent submission", async () => {
      const nonExistentId = 99999;

      await assert.rejects(
        async () => await deleteSubmissionWithAuth(nonExistentId, member1.id, false),
        /Submission not found/
      );
    });
  });
});
