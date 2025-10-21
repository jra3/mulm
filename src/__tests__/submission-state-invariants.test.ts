import { describe, test, beforeEach, afterEach } from "node:test";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import {
  getSubmissionById,
  confirmWitness,
  declineWitness,
  approveSubmission,
  requestChanges,
  updateSubmission,
} from "../db/submissions";
import { createMember, getMember } from "../db/members";
import { assertSubmissionInvariantsHold } from "./helpers/assertInvariants";

/**
 * Submission State Machine Invariant Tests
 *
 * These tests verify that ALL state transitions maintain critical invariants.
 * Invariants are rules that must ALWAYS be true, regardless of code path taken.
 *
 * If an invariant is violated, it indicates a serious bug that could corrupt data.
 * Related to Issue #172
 */

interface TestMember {
  id: number;
  display_name: string;
  contact_email: string;
}

void describe("Submission State Machine - Invariant Tests", () => {
  let db: Database;
  let testMember: TestMember;
  let admin: TestMember;

  const mockSpeciesIds = { common_name_id: 1, scientific_name_id: 1 };
  const mockApprovalData = {
    id: 0,
    group_id: 1,
    points: 10,
    article_points: 0,
    first_time_species: false,
    cares_species: false,
    flowered: false,
    sexual_reproduction: false,
  };

  // Helper to create test submission
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
        options.denied ? "Test denial" : null,
        options.changesRequested ? now : null,
        options.changesRequested ? admin.id : null,
        options.changesRequested ? "Test feedback" : null,
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
      // Ignore close errors
    }
  });

  void describe("Draft State Invariants", () => {
    void test("draft submission maintains invariants", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: false,
      });

      const submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });
  });

  void describe("Submitted State Transition Invariants", () => {
    void test("submitting draft maintains invariants", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
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
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
      });

      await confirmWitness(submissionId, admin.id);

      const submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });

    void test("declining witness maintains invariants", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
      });

      await declineWitness(submissionId, admin.id);

      const submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });
  });

  void describe("Approval Transition Invariants", () => {
    void test("approving submission maintains invariants", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
      });

      await approveSubmission(admin.id, submissionId, mockSpeciesIds, mockApprovalData);

      const submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });

    void test("approval with all bonuses maintains invariants", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
      });

      await approveSubmission(admin.id, submissionId, mockSpeciesIds, {
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
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
      });

      await requestChanges(submissionId, admin.id, "Please add more photos");

      const submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });

    void test("resubmitting after changes requested maintains invariants", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
        submitted: true,
        witnessed: true,
        changesRequested: true,
      });

      // Simulate resubmit (clear changes_requested fields, preserve witness data)
      await updateSubmission(submissionId, {
        changes_requested_on: null,
        changes_requested_by: null,
        changes_requested_reason: null,
        submitted_on: new Date().toISOString(),
      });

      const submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });
  });

  void describe("Complex State Chains", () => {
    void test("full happy path: draft → submit → witness → approve", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
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
      await confirmWitness(submissionId, admin.id);
      submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);

      // Step 3: Approve
      await approveSubmission(admin.id, submissionId, mockSpeciesIds, mockApprovalData);
      submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });

    void test("changes-requested workflow: submit → witness → request changes → resubmit → approve", async () => {
      const submissionId = await createTestSubmission({
        memberId: testMember.id,
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
      await confirmWitness(submissionId, admin.id);
      submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);

      // Request changes
      await requestChanges(submissionId, admin.id, "Add photos");
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
      await approveSubmission(admin.id, submissionId, mockSpeciesIds, mockApprovalData);
      submission = await getSubmissionById(submissionId);
      await assertSubmissionInvariantsHold(submission);
    });
  });
});
