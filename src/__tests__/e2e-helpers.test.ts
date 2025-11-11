import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

/**
 * Unit tests for E2E test helpers
 *
 * These tests call the actual E2E helper functions to verify they work with
 * the current database schema. This catches SQL errors (column/value mismatches)
 * at unit test time (~1 second) instead of E2E test time (10+ minutes in CI).
 *
 * Strategy:
 * - Setup: Use setupTestDatabase() for in-memory db + test users
 * - Call: E2E helpers (e2e/helpers/submissions.ts)
 * - Verify: Database layer methods (src/db/submissions.ts)
 * - Same conventions as all other unit tests
 */

import { setupTestDatabase, teardownTestDatabase, type TestContext } from "./helpers/testHelpers";
import { createTestSubmission, deleteSubmissionsForMember } from "../../e2e/helpers/submissions";
import { getSubmissionById } from "@/db/submissions";

void describe("E2E Test Helpers", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void describe("createTestSubmission() - Fish", () => {
    void test("should create basic Fish submission", async () => {
      const submissionId = await createTestSubmission({
        memberId: ctx.member.id,
        submitted: true,
        speciesType: "Fish",
      });

      const submission = await getSubmissionById(submissionId);

      assert.ok(submission, "Submission should be created");
      assert.strictEqual(submission.species_type, "Fish");
      assert.strictEqual(submission.program, "fish");
      assert.ok(submission.count, "Fish should have count");
      assert.strictEqual(submission.propagation_method, null, "Fish should not have propagation");
      assert.strictEqual(submission.light_type, null, "Fish should not have lighting");
    });

    void test("should create Fish with custom values", async () => {
      const submissionId = await createTestSubmission({
        memberId: ctx.member.id,
        submitted: true,
        speciesType: "Fish",
        speciesClass: "Livebearers",
        speciesCommonName: "Guppy",
        speciesLatinName: "Poecilia reticulata",
        count: "50",
        foods: ["Live", "Flake"],
        spawnLocations: ["Floating plants"],
      });

      const submission = await getSubmissionById(submissionId);

      assert.ok(submission);
      assert.strictEqual(submission.species_class, "Livebearers");
      assert.strictEqual(submission.count, "50");
      assert.strictEqual(submission.foods, JSON.stringify(["Live", "Flake"]));
    });

    void test("should create witnessed Fish submission", async () => {
      const submissionId = await createTestSubmission({
        memberId: ctx.member.id,
        submitted: true,
        witnessed: true,
        witnessedBy: ctx.admin.id,
        speciesType: "Fish",
      });

      const submission = await getSubmissionById(submissionId);

      assert.ok(submission);
      assert.strictEqual(submission.witness_verification_status, "confirmed");
      assert.ok(submission.witnessed_on);
    });

    void test("should create approved Fish submission", async () => {
      const submissionId = await createTestSubmission({
        memberId: ctx.member.id,
        submitted: true,
        witnessed: true,
        approved: true,
        approvedBy: ctx.admin.id,
        points: 10,
        speciesType: "Fish",
      });

      const submission = await getSubmissionById(submissionId);

      assert.ok(submission);
      assert.ok(submission.approved_on);
      assert.strictEqual(submission.points, 10);
    });
  });

  void describe("createTestSubmission() - Plant", () => {
    void test("should create Plant with all Plant-specific fields", async () => {
      const submissionId = await createTestSubmission({
        memberId: ctx.member.id,
        submitted: true,
        speciesType: "Plant",
        speciesClass: "Cryptocoryne",
        speciesCommonName: "Wendt's Cryptocoryne",
        speciesLatinName: "Cryptocoryne wendtii",
        propagationMethod: "Cuttings",
        lightType: "LED",
        lightStrength: "200W",
        lightHours: "16",
        co2: "no",
      });

      const submission = await getSubmissionById(submissionId);

      assert.ok(submission);
      assert.strictEqual(submission.species_type, "Plant");
      assert.strictEqual(submission.program, "plant");
      assert.strictEqual(submission.propagation_method, "Cuttings");
      assert.strictEqual(submission.light_type, "LED");
      assert.strictEqual(submission.count, null, "Plant should not have count");
    });

    void test("should create Plant with CO2 supplementation", async () => {
      const submissionId = await createTestSubmission({
        memberId: ctx.member.id,
        submitted: true,
        speciesType: "Plant",
        co2: "yes",
        co2Description: "DIY CO2 system",
      });

      const submission = await getSubmissionById(submissionId);

      assert.ok(submission);
      assert.strictEqual(submission.co2, "yes");
      assert.strictEqual(submission.co2_description, "DIY CO2 system");
    });
  });

  void describe("createTestSubmission() - Coral", () => {
    void test("should create Coral with all Coral-specific fields", async () => {
      const submissionId = await createTestSubmission({
        memberId: ctx.member.id,
        submitted: true,
        speciesType: "Coral",
        speciesClass: "Hard",
        speciesCommonName: "Staghorn Coral",
        speciesLatinName: "Acropora millepora",
        waterType: "Salt",
        foods: ["Live", "Reef Roids"],
        propagationMethod: "Fragmentation",
        lightType: "LED",
        co2: "no",
      });

      const submission = await getSubmissionById(submissionId);

      assert.ok(submission);
      assert.strictEqual(submission.species_type, "Coral");
      assert.strictEqual(submission.program, "coral");
      assert.strictEqual(submission.propagation_method, "Fragmentation");
      assert.strictEqual(submission.foods, JSON.stringify(["Live", "Reef Roids"]));
      assert.strictEqual(submission.count, null, "Coral should not have count");
    });

    void test("should create Coral with budding propagation", async () => {
      const submissionId = await createTestSubmission({
        memberId: ctx.member.id,
        submitted: true,
        speciesType: "Coral",
        propagationMethod: "Budding",
      });

      const submission = await getSubmissionById(submissionId);

      assert.ok(submission);
      assert.strictEqual(submission.propagation_method, "Budding");
    });
  });

  void describe("deleteSubmissionsForMember()", () => {
    void test("should delete all submissions for a member", async () => {
      // Create multiple submitted submissions (getSubmissionsByMember only returns submitted ones)
      const id1 = await createTestSubmission({ memberId: ctx.member.id, submitted: true, speciesType: "Fish" });
      const id2 = await createTestSubmission({ memberId: ctx.member.id, submitted: true, speciesType: "Plant" });
      const id3 = await createTestSubmission({ memberId: ctx.member.id, submitted: true, speciesType: "Coral" });

      // Verify they exist
      const submission1 = await getSubmissionById(id1);
      const submission2 = await getSubmissionById(id2);
      const submission3 = await getSubmissionById(id3);
      assert.ok(submission1);
      assert.ok(submission2);
      assert.ok(submission3);

      // Delete them
      await deleteSubmissionsForMember(ctx.member.id);

      // Verify they're gone
      const deleted1 = await getSubmissionById(id1);
      const deleted2 = await getSubmissionById(id2);
      const deleted3 = await getSubmissionById(id3);
      assert.strictEqual(deleted1, undefined, "Submission 1 should be deleted");
      assert.strictEqual(deleted2, undefined, "Submission 2 should be deleted");
      assert.strictEqual(deleted3, undefined, "Submission 3 should be deleted");
    });
  });
});
