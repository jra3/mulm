import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import { approveSubmission, getSubmissionById } from "../db/submissions";
import { createMember, getMember } from "../db/members";

/**
 * Integration tests for submission approval validation
 * Tests state validation and points calculation for the approval workflow
 */

interface TestMember {
  id: number;
  display_name: string;
  contact_email: string;
}

void describe("Submission Approval - State Validation", () => {
  let db: Database;
  let testMember: TestMember;
  let admin: TestMember;

  const mockSpeciesIds = { common_name_id: 1, scientific_name_id: 1 };
  const mockApprovalData = {
    id: 0, // Will be set per test
    group_id: 1,
    points: 10,
    article_points: 0,
    first_time_species: false,
    cares_species: false,
    flowered: false,
    sexual_reproduction: false,
  };

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

    // Disable foreign key constraints for simpler testing (we're testing validation, not FK integrity)
    await db.exec("PRAGMA foreign_keys = OFF;");

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
    void test("should reject approval of draft submission (not submitted)", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: false,
      });

      await assert.rejects(
        async () => await approveSubmission(admin.id, submissionId, mockSpeciesIds, mockApprovalData),
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
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
        approved: true,
      });

      await assert.rejects(
        async () => await approveSubmission(admin.id, submissionId, mockSpeciesIds, mockApprovalData),
        /Cannot approve already approved submissions/
      );

      // Verify original approval data unchanged
      const submission = await getSubmissionById(submissionId);
      assert.ok(submission?.approved_on !== null);
      assert.strictEqual(submission?.points, 10); // Original points from createTestSubmission
    });
  });

  void describe("Denied Submission Validation", () => {
    void test("should reject approval of denied submission", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
        denied: true,
      });

      await assert.rejects(
        async () => await approveSubmission(admin.id, submissionId, mockSpeciesIds, mockApprovalData),
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
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
      });

      await approveSubmission(admin.id, submissionId, mockSpeciesIds, {
        ...mockApprovalData,
        points: 15,
      });

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission?.approved_on !== null);
      assert.strictEqual(submission?.approved_by, admin.id);
      assert.strictEqual(submission?.points, 15);
      assert.strictEqual(submission?.common_name_id, 1);
      assert.strictEqual(submission?.scientific_name_id, 1);
    });

    void test("should apply first-time species bonus correctly", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
      });

      await approveSubmission(admin.id, submissionId, mockSpeciesIds, {
        ...mockApprovalData,
        points: 10,
        first_time_species: true,
      });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 10);
      assert.strictEqual(submission?.first_time_species, 1);
    });

    void test("should apply CARES species bonus correctly", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
      });

      await approveSubmission(admin.id, submissionId, mockSpeciesIds, {
        ...mockApprovalData,
        points: 10,
        cares_species: true,
      });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 10);
      assert.strictEqual(submission?.cares_species, 1);
    });

    void test("should apply article points correctly", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
      });

      await approveSubmission(admin.id, submissionId, mockSpeciesIds, {
        ...mockApprovalData,
        points: 10,
        article_points: 5,
      });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 10);
      assert.strictEqual(submission?.article_points, 5);
    });

    void test("should apply plant bonuses correctly", async () => {
      // Need to create a plant submission
      const plantSubmissionId = await db.run(
        `INSERT INTO submissions (
          member_id, species_class, species_type, species_common_name,
          species_latin_name, reproduction_date, temperature, ph, gh,
          water_type, witness_verification_status, program, submitted_on
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          testMember.id,
          "Aquatic Plants",
          "Plant",
          "Amazon Sword",
          "Echinodorus amazonicus",
          new Date().toISOString(),
          "75",
          "7.0",
          "150",
          "Fresh",
          "confirmed",
          "plant",
          new Date().toISOString(),
        ]
      );

      await approveSubmission(admin.id, plantSubmissionId.lastID as number, mockSpeciesIds, {
        ...mockApprovalData,
        points: 10,
        flowered: true,
        sexual_reproduction: true,
      });

      const submission = await getSubmissionById(plantSubmissionId.lastID as number);
      assert.strictEqual(submission?.points, 10);
      assert.strictEqual(submission?.flowered, 1);
      assert.strictEqual(submission?.sexual_reproduction, 1);
    });
  });

  void describe("Non-existent Submission", () => {
    void test("should reject approval of non-existent submission", async () => {
      const nonExistentId = 99999;

      await assert.rejects(
        async () => await approveSubmission(admin.id, nonExistentId, mockSpeciesIds, mockApprovalData),
        /Submission not found/
      );
    });
  });
});
