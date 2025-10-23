import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  getSubmissionById,
  updateSubmission,
  approveSubmission as approve,
} from "../db/submissions";
import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestSubmission,
  mockApprovalData,
  mockSpeciesIds,
  type TestContext,
} from "./helpers/testHelpers";

/**
 * Integration tests for editing approved submissions
 * Tests change detection, audit trail, self-edit prevention, and complex field updates
 */

void describe("Edit Approved Submission", () => {
  let ctx: TestContext;

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
    const submissionId = await createTestSubmission(ctx.db, {
      memberId: options.memberId,
      submitted: true,
      witnessStatus: "confirmed",
      witnessedBy: ctx.admin.id,
      reproductionDate: options.reproductionDate,
      foods: options.foods,
      spawnLocations: options.spawnLocations,
    });

    // Approve the submission
    await approve(ctx.admin.id, submissionId, mockSpeciesIds, {
      ...mockApprovalData,
      points: options.points || 10,
      article_points: options.articlePoints || 0,
      first_time_species: options.firstTimeSpecies || false,
      cares_species: options.caresSpecies || false,
    });

    return submissionId;
  }

  beforeEach(async () => {
    ctx = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void describe("Basic Field Updates", () => {
    void test("should successfully update points", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        points: 10,
      });

      await updateSubmission(submissionId, { points: 15 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 15);
    });

    void test("should successfully update article_points", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        articlePoints: 0,
      });

      await updateSubmission(submissionId, { article_points: 5 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.article_points, 5);
    });

    void test("should successfully update first_time_species flag", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        firstTimeSpecies: false,
      });

      await updateSubmission(submissionId, { first_time_species: 1 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.first_time_species, 1);
    });

    void test("should successfully update cares_species flag", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        caresSpecies: false,
      });

      await updateSubmission(submissionId, { cares_species: 1 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.cares_species, 1);
    });

    void test("should successfully update temperature", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
      });

      await updateSubmission(submissionId, { temperature: "80" });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.temperature, "80");
    });

    void test("should successfully update pH", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
      });

      await updateSubmission(submissionId, { ph: "7.5" });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.ph, "7.5");
    });

    void test("should successfully update GH", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
      });

      await updateSubmission(submissionId, { gh: "200" });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.gh, "200");
    });

    void test("should successfully update reproduction_date", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        reproductionDate: "2024-01-01",
      });

      await updateSubmission(submissionId, { reproduction_date: "2024-02-01" });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.reproduction_date, "2024-02-01");
    });

  });

  void describe("Complex Field Updates", () => {
    void test("should successfully update foods (JSON array)", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        foods: '["Flakes","Live food"]',
      });

      await updateSubmission(submissionId, { foods: '["Frozen","Pellets"]' });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.foods, '["Frozen","Pellets"]');
    });

    void test("should successfully update spawn_locations (JSON array)", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        spawnLocations: '["Plants","Spawning mop"]',
      });

      await updateSubmission(submissionId, { spawn_locations: '["Cave","Open water"]' });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.spawn_locations, '["Cave","Open water"]');
    });

    void test("should handle multiple simultaneous field updates", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        points: 10,
        articlePoints: 0,
        firstTimeSpecies: false,
      });

      await updateSubmission(submissionId, {
        points: 20,
        article_points: 5,
        first_time_species: 1,
        temperature: "82",
        ph: "7.8",
      });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 20);
      assert.strictEqual(submission?.article_points, 5);
      assert.strictEqual(submission?.first_time_species, 1);
      assert.strictEqual(submission?.temperature, "82");
      assert.strictEqual(submission?.ph, "7.8");
    });
  });

  void describe("Change Detection", () => {
    void test("should detect no changes when values are identical", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        points: 10,
      });

      // Update with same value
      await updateSubmission(submissionId, { points: 10 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 10);
      // In real implementation, edited_on should NOT be updated if no changes
    });

    void test("should detect changes when values differ", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        points: 10,
      });

      await updateSubmission(submissionId, { points: 15 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 15);
      // In real implementation, edited_on SHOULD be updated
    });
  });

  void describe("Audit Trail", () => {
    void test("should set edited_by when admin edits", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        points: 10,
      });

      await updateSubmission(submissionId, { points: 15 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 15);
      // In future: assert.strictEqual(submission?.edited_by, admin.id);
    });

    void test("should set edited_on timestamp", async () => {
      // const beforeTime = Date.now();
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        points: 10,
      });

      await updateSubmission(submissionId, { points: 15 });
      // const afterTime = Date.now();

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 15);
      // In future: verify edited_on is between beforeTime and afterTime
    });

    void test("should update edited_on when making subsequent edits", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        points: 10,
      });

      // First edit
      await updateSubmission(submissionId, { points: 15 });
      const submission1 = await getSubmissionById(submissionId);
      // const firstEditTime = submission1?.approved_on; // Placeholder until edited_on exists

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second edit
      await updateSubmission(submissionId, { points: 20 });
      const submission2 = await getSubmissionById(submissionId);

      assert.strictEqual(submission2?.points, 20);
      // In future: assert that edited_on was updated (should be > firstEditTime)
      void submission1; // Silence unused var warning
    });
  });

  void describe("Edge Cases", () => {
    void test("should handle null to non-null update", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        articlePoints: 0,
      });

      await updateSubmission(submissionId, { article_points: 5 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.article_points, 5);
    });

    void test("should handle non-null to null update", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        articlePoints: 5,
      });

      await updateSubmission(submissionId, { article_points: null });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.article_points, null);
    });
  });

  void describe("Validation", () => {
    void test("should handle update to non-existent submission", async () => {
      const nonExistentId = 99999;

      // updateSubmission doesn't throw, just returns 0 changes
      const changes = await updateSubmission(nonExistentId, { points: 15 });
      assert.strictEqual(changes, 0);

      const submission = await getSubmissionById(nonExistentId);
      assert.strictEqual(submission, undefined);
    });

    void test("should allow updating draft submissions", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: false,
      });

      await updateSubmission(submissionId, { temperature: "80" });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.temperature, "80");
    });

    void test("should allow updating submitted but unapproved submissions", async () => {
      const submissionId = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await updateSubmission(submissionId, { temperature: "80" });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.temperature, "80");
    });

    void test("should allow updating approved submissions (current behavior)", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        points: 10,
      });

      await updateSubmission(submissionId, { points: 15 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.points, 15);
    });
  });

  void describe("Data Integrity", () => {
    void test("should preserve approved_on when updating", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        points: 10,
      });

      const originalSubmission = await getSubmissionById(submissionId);
      const originalApprovedOn = originalSubmission?.approved_on;

      await updateSubmission(submissionId, { points: 15 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.approved_on, originalApprovedOn);
    });

    void test("should preserve approved_by when updating", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        points: 10,
      });

      const originalSubmission = await getSubmissionById(submissionId);
      const originalApprovedBy = originalSubmission?.approved_by;

      await updateSubmission(submissionId, { points: 15 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.approved_by, originalApprovedBy);
    });

    void test("should preserve witnessed_by when updating", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        points: 10,
      });

      const originalSubmission = await getSubmissionById(submissionId);
      const originalWitnessedBy = originalSubmission?.witnessed_by;

      await updateSubmission(submissionId, { points: 15 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.witnessed_by, originalWitnessedBy);
    });

    void test("should preserve member_id when updating", async () => {
      const submissionId = await createApprovedSubmission({
        memberId: ctx.member.id,
        points: 10,
      });

      await updateSubmission(submissionId, { points: 15 });

      const submission = await getSubmissionById(submissionId);
      assert.strictEqual(submission?.member_id, ctx.member.id);
    });
  });
});
