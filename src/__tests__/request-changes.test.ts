import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import { requestChanges, getSubmissionById } from "../db/submissions";
import { createMember, getMember } from "../db/members";

/**
 * Integration tests for request changes workflow
 * Tests state validation and audit trail for admin-requested changes
 */

interface TestMember {
  id: number;
  display_name: string;
  contact_email: string;
}

void describe("Request Changes Workflow", () => {
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
    changesRequested?: boolean;
  }): Promise<number> {
    const now = new Date().toISOString();
    const result = await db.run(
      `INSERT INTO submissions (
        member_id, species_class, species_type, species_common_name,
        species_latin_name, reproduction_date, temperature, ph, gh,
        water_type, witness_verification_status, program,
        submitted_on, witnessed_by, witnessed_on,
        approved_on, approved_by, points,
        denied_on, denied_by, denied_reason,
        changes_requested_on, changes_requested_by, changes_requested_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        options.changesRequested ? now : null,
        options.changesRequested ? admin.id : null,
        options.changesRequested ? "Test change request" : null,
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

  void describe("Happy Path", () => {
    void test("should successfully request changes on submitted submission", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
      });

      const reason = "Please provide better photos of the fry";
      await requestChanges(submissionId, admin.id, reason);

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission?.changes_requested_on !== null);
      assert.strictEqual(submission?.changes_requested_by, admin.id);
      assert.strictEqual(submission?.changes_requested_reason, reason);
    });

    void test("should set changes_requested_on timestamp", async () => {
      const beforeTime = Date.now();
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
      });

      await requestChanges(submissionId, admin.id, "Need more details");
      const afterTime = Date.now();

      const submission = await getSubmissionById(submissionId);
      const requestedTime = new Date(submission!.changes_requested_on!).getTime();

      assert.ok(requestedTime >= beforeTime);
      assert.ok(requestedTime <= afterTime);
    });

    void test("should store admin ID who requested changes", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
      });

      await requestChanges(submissionId, admin.id, "Fix water parameters");

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_by, admin.id);
    });

    void test("should store the change request reason", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
      });

      const reason = "Temperature seems too low for this species. Please verify.";
      await requestChanges(submissionId, admin.id, reason);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, reason);
    });

    void test("should allow requesting changes on witnessed submission", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
      });

      await requestChanges(submissionId, admin.id, "Need clarification on spawn location");

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission?.changes_requested_on !== null);
      // Witness status should remain unchanged
      assert.strictEqual(submission?.witness_verification_status, "confirmed");
      assert.ok(submission?.witnessed_on !== null);
    });
  });

  void describe("State Validation", () => {
    void test("should reject request changes on draft submission", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: false, // Draft
      });

      await assert.rejects(
        async () => await requestChanges(submissionId, admin.id, "Please fix"),
        /Cannot request changes on draft submissions/
      );

      // Verify no changes were made
      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_on, null);
      assert.strictEqual(submission?.changes_requested_by, null);
      assert.strictEqual(submission?.changes_requested_reason, null);
    });

    void test("should reject request changes on approved submission", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
        approved: true,
      });

      await assert.rejects(
        async () => await requestChanges(submissionId, admin.id, "Please fix"),
        /Cannot request changes on approved submissions/
      );

      // Verify no changes were made
      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_on, null);
    });

    void test("should reject request changes on denied submission", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        denied: true,
      });

      await assert.rejects(
        async () => await requestChanges(submissionId, admin.id, "Please fix"),
        /Cannot request changes on denied submissions/
      );

      // Verify no changes were made
      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_on, null);
    });

    void test("should reject request changes on non-existent submission", async () => {
      const nonExistentId = 99999;

      await assert.rejects(
        async () => await requestChanges(nonExistentId, admin.id, "Please fix"),
        /Submission not found/
      );
    });
  });

  void describe("Multiple Change Requests", () => {
    void test("should allow updating existing change request", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        changesRequested: true,
      });

      const newReason = "Additional changes needed: please provide video link";
      await requestChanges(submissionId, admin.id, newReason);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, newReason);
    });

    void test("should update timestamp when requesting changes again", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        changesRequested: true,
      });

      // Get original timestamp
      const originalSubmission = await getSubmissionById(submissionId);
      const originalTime = new Date(originalSubmission!.changes_requested_on!).getTime();

      // Wait a small amount to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      // Request changes again
      await requestChanges(submissionId, admin.id, "New changes needed");

      const updatedSubmission = await getSubmissionById(submissionId);
      const newTime = new Date(updatedSubmission!.changes_requested_on!).getTime();

      assert.ok(newTime > originalTime, "New timestamp should be later than original");
    });
  });

  void describe("Reason Validation", () => {
    void test("should handle empty string reason", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
      });

      // Empty string is allowed by the database function
      // (route handler should validate non-empty)
      await requestChanges(submissionId, admin.id, "");

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, "");
    });

    void test("should handle very long reason text", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
      });

      const longReason = "A".repeat(5000); // Very long reason
      await requestChanges(submissionId, admin.id, longReason);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, longReason);
    });

    void test("should handle special characters in reason", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
      });

      const specialReason = "Please fix: pH > 7.0, temp < 75°F, and use \"proper\" lighting";
      await requestChanges(submissionId, admin.id, specialReason);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, specialReason);
    });

    void test("should handle newlines in reason", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
      });

      const multilineReason = `Please make the following changes:
1. Add better photos
2. Clarify spawn location
3. Verify temperature readings`;

      await requestChanges(submissionId, admin.id, multilineReason);

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, multilineReason);
    });
  });

  void describe("Workflow Integration", () => {
    void test("should allow member to resubmit after changes requested", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
      });

      await requestChanges(submissionId, admin.id, "Need better photos");

      // Verify changes were requested
      let submission = await getSubmissionById(submissionId);
      assert.ok(submission?.changes_requested_on !== null);

      // Simulate member making changes and clearing the request (would be done in update logic)
      await db.run(
        `UPDATE submissions SET
          changes_requested_on = NULL,
          changes_requested_by = NULL,
          changes_requested_reason = NULL
        WHERE id = ?`,
        [submissionId]
      );

      // Verify fields cleared
      submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_on, null);
      assert.strictEqual(submission?.changes_requested_by, null);
      assert.strictEqual(submission?.changes_requested_reason, null);
    });

    void test("should preserve witness status when requesting changes", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
      });

      const originalSubmission = await getSubmissionById(submissionId);
      const originalWitnessedBy = originalSubmission!.witnessed_by;
      const originalWitnessedOn = originalSubmission!.witnessed_on;

      await requestChanges(submissionId, admin.id, "Need clarification");

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.witness_verification_status, "confirmed");
      assert.strictEqual(submission?.witnessed_by, originalWitnessedBy);
      assert.strictEqual(submission?.witnessed_on, originalWitnessedOn);
    });

    void test("should not affect approval-related fields", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
      });

      await requestChanges(submissionId, admin.id, "Need more info");

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.approved_on, null);
      assert.strictEqual(submission?.approved_by, null);
      assert.strictEqual(submission?.points, null);
      assert.strictEqual(submission?.denied_on, null);
      assert.strictEqual(submission?.denied_by, null);
    });
  });

  void describe("Edge Cases", () => {
    void test("should handle request changes from same admin multiple times", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
      });

      await requestChanges(submissionId, admin.id, "First request");
      await requestChanges(submissionId, admin.id, "Second request");
      await requestChanges(submissionId, admin.id, "Third request");

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, "Third request");
      assert.strictEqual(submission?.changes_requested_by, admin.id);
    });

    void test("should handle request changes from different admins", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
      });

      // First admin requests changes
      await requestChanges(submissionId, admin.id, "First admin's request");

      // Create second admin
      const admin2Email = `admin2-${Date.now()}@test.com`;
      const admin2Id = await createMember(admin2Email, "Second Admin");
      const admin2 = (await getMember(admin2Id)) as TestMember;

      // Second admin overwrites with new request
      await requestChanges(submissionId, admin2.id, "Second admin's request");

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_by, admin2.id);
      assert.strictEqual(submission?.changes_requested_reason, "Second admin's request");
    });

    void test("should allow admin to request changes on own submission (no self-restriction)", async () => {
      // Unlike witness operations, admins CAN request changes on their own submissions
      const submissionId = await createTestSubmission({
        memberId: admin.id, // Admin owns this submission
        submitted: true,
      });

      // Should succeed - no self-request restriction
      await requestChanges(submissionId, admin.id, "I need to fix this");

      const submission = await getSubmissionById(submissionId);
      assert.ok(submission?.changes_requested_on !== null);
      assert.strictEqual(submission?.changes_requested_by, admin.id);
    });
  });

  void describe("Transaction Integrity", () => {
    void test("should handle sequential change requests", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
      });

      // First request
      await requestChanges(submissionId, admin.id, "First request");
      let submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, "First request");

      // Second request should overwrite
      await requestChanges(submissionId, admin.id, "Second request");
      submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.changes_requested_reason, "Second request");
    });
  });
});
