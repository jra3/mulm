import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import { requestChanges, getSubmissionById } from "../db/submissions";
import { createMember, getMember } from "../db/members";

/**
 * Integration tests for request-changes validation
 * Tests state validation and error handling for the changes-requested workflow
 * Related to Issue #176
 */

interface TestMember {
  id: number;
  display_name: string;
  contact_email: string;
}

void describe("Request Changes - State Validation", () => {
  let db: Database;
  let testMember: TestMember;
  let admin: TestMember;

  // Helper to create test submission in specific state
  async function createTestSubmission(options: {
    memberId: number;
    submitted?: boolean;
    witnessed?: boolean;
    approved?: boolean;
    denied?: boolean;
  }): Promise<number> {
    const now = new Date().toISOString();
    const result = await db.run(
      `INSERT INTO submissions (
        member_id, species_class, species_type, species_common_name,
        species_latin_name, reproduction_date, temperature, ph, gh,
        water_type, witness_verification_status, program,
        submitted_on, witnessed_by, witnessed_on,
        approved_on, approved_by, points,
        denied_on, denied_by, denied_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        options.witnessed ? "confirmed" : "pending",
        "fish",
        options.submitted ? now : null,
        options.witnessed ? admin.id : null,
        options.witnessed ? now : null,
        options.approved ? now : null,
        options.approved ? admin.id : null,
        options.approved ? 10 : null,
        options.denied ? now : null,
        options.denied ? admin.id : null,
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
    const adminEmail = `admin-${Date.now()}@test.com`;

    const memberId = await createMember(memberEmail, "Test Member");
    const adminId = await createMember(adminEmail, "Test Admin");

    testMember = (await getMember(memberId)) as TestMember;
    admin = (await getMember(adminId)) as TestMember;
  });

  afterEach(async () => {
    try {
      await db.close();
    } catch {
      // Ignore close errors in tests
    }
  });

  void describe("Draft Submission Validation", () => {
    void test("should reject request changes on draft submission (not submitted)", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: false,
      });

      await assert.rejects(
        async () => await requestChanges(submissionId, admin.id, "Please add photos"),
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
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
        approved: true,
      });

      await assert.rejects(
        async () => await requestChanges(submissionId, admin.id, "Too late for changes"),
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
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
        denied: true,
      });

      await assert.rejects(
        async () => await requestChanges(submissionId, admin.id, "Already denied"),
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
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
      });

      await requestChanges(submissionId, admin.id, "Please add more photos");

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission?.changes_requested_on !== null);
      assert.strictEqual(submission?.changes_requested_by, admin.id);
      assert.strictEqual(submission?.changes_requested_reason, "Please add more photos");

      // Verify witness data preserved
      assert.strictEqual(submission?.witnessed_by, admin.id);
      assert.ok(submission?.witnessed_on !== null);
      assert.strictEqual(submission?.witness_verification_status, "confirmed");
    });

    void test("should allow multiple change requests (updates reason)", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
      });

      // First request
      await requestChanges(submissionId, admin.id, "First feedback");

      // Second request (should update, not error)
      await requestChanges(submissionId, admin.id, "Updated feedback");

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, "Updated feedback");
    });
  });

  void describe("Non-existent Submission", () => {
    void test("should reject non-existent submission", async () => {
      const nonExistentId = 99999;

      await assert.rejects(
        async () => await requestChanges(nonExistentId, admin.id, "Feedback"),
        /Submission not found/
      );
    });
  });
});
