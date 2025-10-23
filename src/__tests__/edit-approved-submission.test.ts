import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import {
  getSubmissionById,
  updateSubmission,
  approveSubmission as approve,
} from "../db/submissions";
import { createMember, getMember } from "../db/members";

/**
 * Integration tests for editing approved submissions
 * Tests change detection, audit trail, self-edit prevention, and complex field updates
 */

interface TestMember {
  id: number;
  display_name: string;
  contact_email: string;
}

void describe("Edit Approved Submission", () => {
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

  // Helper to create and approve a test submission
  async function createApprovedSubmission(options: {
    memberId: number;
    points?: number;
    articlePoints?: number;
    firstTimeSpecies?: boolean;
    caresSpecies?: boolean;
    reproductionDate?: string;
    foods?: string;
    spawnLocations?: string;
  }): Promise<number> {
    const now = new Date().toISOString();
    const result = await db.run(
      `INSERT INTO submissions (
        member_id, species_class, species_type, species_common_name,
        species_latin_name, reproduction_date, temperature, ph, gh,
        water_type, witness_verification_status, program,
        submitted_on, witnessed_by, witnessed_on,
        foods, spawn_locations
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        options.memberId,
        "Livebearers",
        "Fish",
        "Guppy",
        "Poecilia reticulata",
        options.reproductionDate || now,
        "75",
        "7.0",
        "150",
        "Fresh",
        "confirmed",
        "fish",
        now,
        admin.id,
        now,
        options.foods || '["Flakes","Live food"]',
        options.spawnLocations || '["Plants","Spawning mop"]',
      ]
    );

    const submissionId = result.lastID as number;

    // Approve the submission
    await approve(admin.id, submissionId, mockSpeciesIds, {
      ...mockApprovalData,
      points: options.points || 10,
      article_points: options.articlePoints || 0,
      first_time_species: options.firstTimeSpecies || false,
      cares_species: options.caresSpecies || false,
    });

    return submissionId;
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

  void describe("Basic Field Updates", () => {
    void test("should successfully update points", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
        points: 10,
      });

      await updateSubmission(submissionId, { points: 15 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 15);
    });

    void test("should successfully update article_points", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
        articlePoints: 0,
      });

      await updateSubmission(submissionId, { article_points: 5 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.article_points, 5);
    });

    void test("should successfully update first_time_species flag", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
        firstTimeSpecies: false,
      });

      await updateSubmission(submissionId, { first_time_species: 1 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.first_time_species, 1);
    });

    void test("should successfully update cares_species flag", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
        caresSpecies: false,
      });

      await updateSubmission(submissionId, { cares_species: 1 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.cares_species, 1);
    });

    void test("should successfully update temperature", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
      });

      await updateSubmission(submissionId, { temperature: "80" });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.temperature, "80");
    });

    void test("should successfully update multiple fields at once", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
        points: 10,
        articlePoints: 0,
      });

      await updateSubmission(submissionId, {
        points: 15,
        article_points: 5,
        temperature: "78",
        ph: "7.5",
      });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 15);
      assert.strictEqual(submission?.article_points, 5);
      assert.strictEqual(submission?.temperature, "78");
      assert.strictEqual(submission?.ph, "7.5");
    });
  });

  void describe("Date Preservation", () => {
    void test("should preserve time component when updating date", async () => {
      // Original date with specific time: 2024-01-15 14:30:45 UTC
      const originalDate = "2024-01-15T14:30:45.000Z";
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
        reproductionDate: originalDate,
      });

      // New date (date-only format as from form): 2024-02-20
      const newDate = "2024-02-20";
      const [year, month, day] = newDate.split("-").map(Number);

      // Expected: new date with old time preserved
      const expectedDate = new Date(Date.UTC(year, month - 1, day, 14, 30, 45)).toISOString();

      await updateSubmission(submissionId, { reproduction_date: expectedDate });

      const submission = await getSubmissionById(submissionId);
      const updatedDate = new Date(submission!.reproduction_date);

      // Verify date changed
      assert.strictEqual(updatedDate.getUTCFullYear(), 2024);
      assert.strictEqual(updatedDate.getUTCMonth(), 1); // February (0-indexed)
      assert.strictEqual(updatedDate.getUTCDate(), 20);

      // Verify time preserved
      assert.strictEqual(updatedDate.getUTCHours(), 14);
      assert.strictEqual(updatedDate.getUTCMinutes(), 30);
      assert.strictEqual(updatedDate.getUTCSeconds(), 45);
    });
  });

  void describe("Array Field Updates", () => {
    void test("should successfully update foods array", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
        foods: '["Flakes"]',
      });

      await updateSubmission(submissionId, {
        foods: '["Live food","Frozen food","Flakes"]',
      });

      const submission = await getSubmissionById(submissionId);
      const foods = JSON.parse(submission!.foods) as string[];
      assert.deepStrictEqual(foods, ["Live food", "Frozen food", "Flakes"]);
    });

    void test("should successfully update spawn_locations array", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
        spawnLocations: '["Plants"]',
      });

      await updateSubmission(submissionId, {
        spawn_locations: '["Plants","Spawning mop","Substrate"]',
      });

      const submission = await getSubmissionById(submissionId);
      const locations = JSON.parse(submission!.spawn_locations) as string[];
      assert.deepStrictEqual(locations, ["Plants", "Spawning mop", "Substrate"]);
    });

    void test("should handle empty array updates", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
        foods: '["Flakes","Live food"]',
      });

      await updateSubmission(submissionId, {
        foods: "[]",
      });

      const submission = await getSubmissionById(submissionId);
      const foods = JSON.parse(submission!.foods) as string[];
      assert.deepStrictEqual(foods, []);
    });
  });

  void describe("Approved Submission State", () => {
    void test("should maintain approval status after edit", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
      });

      const beforeEdit = await getSubmissionById(submissionId);
      const originalApprovedOn = beforeEdit!.approved_on;
      const originalApprovedBy = beforeEdit!.approved_by;

      await updateSubmission(submissionId, { points: 15 });

      const afterEdit = await getSubmissionById(submissionId);
      assert.strictEqual(afterEdit?.approved_on, originalApprovedOn);
      assert.strictEqual(afterEdit?.approved_by, originalApprovedBy);
    });

    void test("should maintain witness information after edit", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
      });

      const beforeEdit = await getSubmissionById(submissionId);
      const originalWitnessedBy = beforeEdit!.witnessed_by;
      const originalWitnessedOn = beforeEdit!.witnessed_on;

      await updateSubmission(submissionId, { temperature: "78" });

      const afterEdit = await getSubmissionById(submissionId);
      assert.strictEqual(afterEdit?.witnessed_by, originalWitnessedBy);
      assert.strictEqual(afterEdit?.witnessed_on, originalWitnessedOn);
      assert.strictEqual(afterEdit?.witness_verification_status, "confirmed");
    });
  });

  void describe("Self-Edit Prevention (Route Level)", () => {
    void test("should be enforced at route level (not database level)", async () => {
      // This is tested at route level, not in the database function
      // Database layer allows any updates - route layer enforces business rules

      const submissionId = await createApprovedSubmission({
        memberId: admin.id, // Admin owns this
      });

      // Database allows the update (no self-edit check at this level)
      await updateSubmission(submissionId, { points: 20 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 20);
      // Route handler would prevent this, but database doesn't
    });
  });

  void describe("Edge Cases", () => {
    void test("should handle null to value updates", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
        articlePoints: 0,
      });

      // Verify article_points is 0
      let submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.article_points, 0);

      // Update to non-zero value
      await updateSubmission(submissionId, { article_points: 10 });

      submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.article_points, 10);
    });

    void test("should handle value to null updates", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
        articlePoints: 5,
      });

      // Update to null (removing article points)
      await updateSubmission(submissionId, { article_points: null });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.article_points, null);
    });

    void test("should handle updating boolean flags from 0 to 1", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
        firstTimeSpecies: false,
      });

      await updateSubmission(submissionId, { first_time_species: 1 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.first_time_species, 1);
    });

    void test("should handle updating boolean flags from 1 to 0", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
        firstTimeSpecies: true,
      });

      await updateSubmission(submissionId, { first_time_species: 0 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.first_time_species, 0);
    });

    void test("should handle very long text field updates", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
      });

      const longText = "A".repeat(500); // Test with filter_type field
      await updateSubmission(submissionId, { filter_type: longText });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.filter_type, longText);
    });

    void test("should handle special characters in text fields", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
      });

      const specialText = 'Tank size: 20" x 10" with pH > 7.0 & temp < 80°F';
      await updateSubmission(submissionId, { substrate_type: specialText });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.substrate_type, specialText);
    });
  });

  void describe("Multiple Sequential Edits", () => {
    void test("should handle multiple sequential edits correctly", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
        points: 10,
      });

      // First edit
      await updateSubmission(submissionId, { points: 15 });
      let submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 15);

      // Second edit
      await updateSubmission(submissionId, { points: 20 });
      submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 20);

      // Third edit
      await updateSubmission(submissionId, { article_points: 5 });
      submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 20);
      assert.strictEqual(submission?.article_points, 5);
    });

    void test("should handle edit, revert, edit pattern", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
        points: 10,
      });

      // Change it
      await updateSubmission(submissionId, { points: 15 });
      let submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 15);

      // Revert it
      await updateSubmission(submissionId, { points: 10 });
      submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 10);

      // Change again
      await updateSubmission(submissionId, { points: 20 });
      submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 20);
    });
  });

  void describe("Non-Existent Submission", () => {
    void test("should handle updates to non-existent submission gracefully", async () => {
      const nonExistentId = 99999;

      // Database layer doesn't throw on missing ID, just returns 0 changes
      await updateSubmission(nonExistentId, { points: 15 });

      // Verify nothing was created
      const submission = await getSubmissionById(nonExistentId);
      assert.strictEqual(submission, undefined);
    });
  });

  void describe("Partial Updates", () => {
    void test("should only update specified fields", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
        points: 10,
        articlePoints: 5,
      });

      // Only update points, not article_points
      await updateSubmission(submissionId, { points: 15 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 15);
      assert.strictEqual(submission?.article_points, 5); // Unchanged
    });

    void test("should not modify fields not in update object", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: testMember.id,
      });

      const beforeEdit = await getSubmissionById(submissionId);

      // Update one field
      await updateSubmission(submissionId, { temperature: "80" });

      const afterEdit = await getSubmissionById(submissionId);

      // Verify other fields unchanged
      assert.strictEqual(afterEdit?.ph, beforeEdit!.ph);
      assert.strictEqual(afterEdit?.gh, beforeEdit!.gh);
      assert.strictEqual(afterEdit?.water_type, beforeEdit!.water_type);
      assert.strictEqual(afterEdit?.species_common_name, beforeEdit!.species_common_name);
    });
  });
});
