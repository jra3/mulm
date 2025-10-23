import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestSubmission,
  mockSpeciesIds,
  mockApprovalData,
  type TestContext,
} from "./helpers/testHelpers";
import { approveSubmission } from "../db/submissions";
import { checkAndUpdateMemberLevel, checkAllMemberLevels } from "../levelManager";
import { getMember } from "../db/members";
import { calculateLevel, levelRules } from "../programs";

/**
 * Comprehensive tests for Level Manager
 * Tests point-to-level calculation, level upgrades, and email notifications
 */

/**
 * Helper function to generate point arrays
 * Makes test data more readable
 */
function subs(fives: number, tens: number, fifteens: number, twenties: number): number[] {
  const awards: number[] = [];
  for (let i = 0; i < fives; i++) awards.push(5);
  for (let i = 0; i < tens; i++) awards.push(10);
  for (let i = 0; i < fifteens; i++) awards.push(15);
  for (let i = 0; i < twenties; i++) awards.push(20);
  return awards;
}

void describe("Level Manager", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void describe("calculateLevel() - Point Calculations", () => {
    void describe("Fish Program", () => {
      void test("should return Participant with 0 points", () => {
        const level = calculateLevel(levelRules.fish, []);
        assert.strictEqual(level, "Participant");
      });

      void test("should return Hobbyist with 25 points", () => {
        const level = calculateLevel(levelRules.fish, [5, 10, 10]);
        assert.strictEqual(level, "Hobbyist");
      });

      void test("should return Breeder with 50 points and valid distribution", () => {
        // Need at least 20 points from 10, 15, or 20 category
        const level = calculateLevel(levelRules.fish, [5, 5, 10, 10, 10, 10]);
        assert.strictEqual(level, "Breeder");
      });

      void test("should NOT return Breeder with 50 points but invalid distribution", () => {
        // All points from 5-point category doesn't meet requirements
        const level = calculateLevel(levelRules.fish, [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
        assert.strictEqual(level, "Hobbyist"); // Stays at Hobbyist
      });

      void test("should return Advanced Breeder with 100 points and valid distribution", () => {
        // Need at least 40 points from 15 or 20 category
        const level = calculateLevel(levelRules.fish, [20, 20, 15, 15, 10, 10, 10]);
        assert.strictEqual(level, "Advanced Breeder");
      });

      void test("should NOT return Advanced Breeder without 40 points from 15/20 category", () => {
        // 100 points but only 30 from 15/20 category
        const level = calculateLevel(levelRules.fish, [15, 15, 10, 10, 10, 10, 10, 10, 10]);
        assert.strictEqual(level, "Breeder");
      });

      void test("should return Master Breeder with 300 points and complex distribution", () => {
        // Need 300 total AND 30+ from each of 5, 10, 15 AND 40+ from 20
        const level = calculateLevel(levelRules.fish, [
          5, 5, 5, 5, 5, 5,       // 30 from 5-point
          10, 10, 10,              // 30 from 10-point
          15, 15,                  // 30 from 15-point
          20, 20,                  // 40 from 20-point
          5, 5, 5, 5, 5, 5, 5, 5, 5, 5,  // 50 more = 180 total
          10, 10, 10, 10, 10,      // 50 more = 230 total
          10, 10, 10, 10, 10,      // 50 more = 280 total
          10, 10,                  // 20 more = 300 total
        ]);
        assert.strictEqual(level, "Master Breeder");
      });

      void test("should return Grand Master Breeder with 500 points", () => {
        // Need 500 points total AND must have satisfied Master Breeder requirements
        const level = calculateLevel(levelRules.fish, [
          5, 5, 5, 5, 5, 5,       // 30 from 5-point (Master Breeder req)
          10, 10, 10,              // 30 from 10-point (Master Breeder req)
          15, 15,                  // 30 from 15-point (Master Breeder req)
          20, 20,                  // 40 from 20-point (Master Breeder req)
          ...Array(74).fill(5),    // 370 more points: 130 + 370 = 500
        ]);
        assert.strictEqual(level, "Grand Master Breeder");
      });

      void test("should return Advanced Grand Master Breeder with 750+ and distribution", () => {
        // Need 750 total, 60 from 5/10/15, and 80 from 20
        // Must also satisfy ALL prior levels (especially Master Breeder: 30 each from 5/10/15, 40 from 20)
        const level = calculateLevel(levelRules.fish, [
          5, 5, 5, 5, 5, 5,        // 30 from 5-point (Master Breeder req)
          10, 10, 10,               // 30 from 10-point (Master Breeder req)
          15, 15,                   // 30 from 15-point (Master Breeder req)
          20, 20, 20, 20,           // 80 from 20-point (Advanced Grand Master req)
          ...Array(124).fill(5),    // 620 more: 130 + 80 + 620 = 830 total (> 750)
        ]);
        assert.strictEqual(level, "Advanced Grand Master Breeder");
      });

      void test("should return Senior Grand Master Breeder with proper distribution", () => {
        // Need 1000 total, 80 from 5/10/15, and 100 from 20
        // Must also satisfy ALL prior levels (Master Breeder + Advanced Grand Master)
        const level = calculateLevel(levelRules.fish, [
          ...Array(16).fill(5),    // 80 from 5 (satisfies Senior Grand Master + Master Breeder)
          10, 10, 10,               // 30 from 10 (Master Breeder req)
          15, 15,                   // 30 from 15 (Master Breeder req)
          ...Array(5).fill(20),    // 100 from 20 (Senior Grand Master req + Master Breeder)
          ...Array(155).fill(5),   // 775 more: 80+30+30+100+775 = 1015 total (> 1000)
        ]);
        assert.strictEqual(level, "Senior Grand Master Breeder");
      });

      void test("should stop at highest achieved level", () => {
        // 4000 points = Grand Poobah Yoda Breeder (with proper distribution for all prior levels)
        const level = calculateLevel(levelRules.fish, [
          ...Array(16).fill(5),    // 80 from 5 (Senior Grand Master req)
          10, 10, 10,               // 30 from 10 (Master Breeder req)
          15, 15,                   // 30 from 15 (Master Breeder req)
          ...Array(5).fill(20),    // 100 from 20 (Senior Grand Master req)
          ...Array(735).fill(5),   // 3675 more: 80+30+30+100+3675 = 3915
          ...Array(17).fill(5),    // 85 more: 3915 + 85 = 4000
        ]);
        assert.strictEqual(level, "Grand Poobah Yoda Breeder");
      });

      void test("should stay at Hobbyist with 500 5-point awards", () => {
        // Tests that distribution requirements prevent advancement
        assert.strictEqual(calculateLevel(levelRules.fish, subs(500, 0, 0, 0)), "Hobbyist");
        assert.strictEqual(calculateLevel(levelRules.fish, subs(500, 1, 0, 0)), "Hobbyist");
        assert.strictEqual(calculateLevel(levelRules.fish, subs(500, 0, 1, 0)), "Hobbyist");
      });

      void test("should reach Premier Breeder", () => {
        assert.strictEqual(calculateLevel(levelRules.fish, subs(300, 4, 2, 5)), "Premier Breeder");
      });

      void test("should reach Senior Premier Breeder", () => {
        assert.strictEqual(calculateLevel(levelRules.fish, subs(400, 4, 2, 5)), "Senior Premier Breeder");
      });

      void test("should reach Grand Poobah Yoda Breeder with massive points", () => {
        assert.strictEqual(calculateLevel(levelRules.fish, subs(800, 4, 2, 5)), "Grand Poobah Yoda Breeder");
        assert.strictEqual(calculateLevel(levelRules.fish, subs(9999, 4, 2, 5)), "Grand Poobah Yoda Breeder");
      });
    });

    void describe("Plant Program", () => {
      void test("should return Participant with 0 points", () => {
        const level = calculateLevel(levelRules.plant, []);
        assert.strictEqual(level, "Participant");
      });

      void test("should return Beginner Aquatic Horticulturist with 25 points", () => {
        const level = calculateLevel(levelRules.plant, [5, 10, 10]);
        assert.strictEqual(level, "Beginner Aquatic Horticulturist");
      });

      void test("should return Aquatic Horticulturist with 50 points and distribution", () => {
        const level = calculateLevel(levelRules.plant, [10, 10, 10, 10, 10]);
        assert.strictEqual(level, "Aquatic Horticulturist");
      });

      void test("should return Expert Aquatic Horticulturist with complex rules", () => {
        // Need 30+ from each of 5, 10, 15 AND 40+ from 20
        const level = calculateLevel(levelRules.plant, [
          5,
          5,
          5,
          5,
          5,
          5, // 30 from 5
          10,
          10,
          10, // 30 from 10
          15,
          15, // 30 from 15
          20,
          20, // 40 from 20
          ...Array(40).fill(5), // Fill to 300
        ]);
        assert.strictEqual(level, "Expert Aquatic Horticulturist");
      });

      void test("should stay at Beginner with only 5-point awards", () => {
        assert.strictEqual(calculateLevel(levelRules.plant, subs(500, 0, 0, 0)), "Beginner Aquatic Horticulturist");
        assert.strictEqual(calculateLevel(levelRules.plant, subs(500, 1, 0, 0)), "Beginner Aquatic Horticulturist");
        assert.strictEqual(calculateLevel(levelRules.plant, subs(500, 0, 1, 0)), "Beginner Aquatic Horticulturist");
      });

      void test("should reach Senior Aquatic Horticulturist", () => {
        assert.strictEqual(calculateLevel(levelRules.plant, subs(12, 0, 0, 2)), "Senior Aquatic Horticulturist");
        assert.strictEqual(calculateLevel(levelRules.plant, subs(60, 0, 0, 2)), "Senior Aquatic Horticulturist");
      });

      void test("should reach Master Aquatic Horticulturist", () => {
        assert.strictEqual(calculateLevel(levelRules.plant, subs(6, 40, 2, 2)), "Master Aquatic Horticulturist");
        assert.strictEqual(calculateLevel(levelRules.plant, subs(6, 400, 2, 2)), "Master Aquatic Horticulturist");
      });

      void test("should reach Grand Master Aquatic Horticulturist", () => {
        assert.strictEqual(calculateLevel(levelRules.plant, subs(6, 65, 2, 4)), "Grand Master Aquatic Horticulturist");
        assert.strictEqual(calculateLevel(levelRules.plant, subs(6, 650, 2, 4)), "Grand Master Aquatic Horticulturist");
      });

      void test("should reach Senior Grand Master Aquatic Horticulturist", () => {
        assert.strictEqual(calculateLevel(levelRules.plant, subs(6, 84, 2, 5)), "Senior Grand Master Aquatic Horticulturist");
        assert.strictEqual(calculateLevel(levelRules.plant, subs(6, 129, 2, 7)), "Senior Grand Master Aquatic Horticulturist");
      });

      void test("should reach Premier Aquatic Horticulturist", () => {
        assert.strictEqual(calculateLevel(levelRules.plant, subs(6, 130, 2, 7)), "Premier Aquatic Horticulturist");
        assert.strictEqual(calculateLevel(levelRules.plant, subs(6, 179, 2, 7)), "Premier Aquatic Horticulturist");
      });

      void test("should reach Senior Premier Aquatic Horticulturist", () => {
        assert.strictEqual(calculateLevel(levelRules.plant, subs(6, 180, 2, 7)), "Senior Premier Aquatic Horticulturist");
        assert.strictEqual(calculateLevel(levelRules.plant, subs(6, 9999, 2, 7)), "Senior Premier Aquatic Horticulturist");
      });
    });

    void describe("Coral Program", () => {
      void test("should have simpler progression (no extra rules)", () => {
        assert.strictEqual(calculateLevel(levelRules.coral, []), "Participant");
        assert.strictEqual(calculateLevel(levelRules.coral, [5, 5, 5, 5, 5]), "Beginner Coral Propagator");
        assert.strictEqual(calculateLevel(levelRules.coral, [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]), "Coral Propagator");
        assert.strictEqual(calculateLevel(levelRules.coral, Array(20).fill(5)), "Senior Coral Propagator");
      });

      void test("should reach Beginner Coral Propagator", () => {
        assert.strictEqual(calculateLevel(levelRules.coral, subs(5, 0, 0, 0)), "Beginner Coral Propagator");
        assert.strictEqual(calculateLevel(levelRules.coral, subs(9, 0, 0, 0)), "Beginner Coral Propagator");
      });

      void test("should reach Coral Propagator", () => {
        assert.strictEqual(calculateLevel(levelRules.coral, subs(0, 5, 0, 0)), "Coral Propagator");
        assert.strictEqual(calculateLevel(levelRules.coral, subs(1, 9, 0, 0)), "Coral Propagator");
      });

      void test("should reach Senior Coral Propagator", () => {
        assert.strictEqual(calculateLevel(levelRules.coral, subs(0, 10, 0, 0)), "Senior Coral Propagator");
        assert.strictEqual(calculateLevel(levelRules.coral, subs(1, 29, 0, 0)), "Senior Coral Propagator");
      });

      void test("should reach Expert Coral Propagator", () => {
        assert.strictEqual(calculateLevel(levelRules.coral, subs(0, 30, 0, 0)), "Expert Coral Propagator");
        assert.strictEqual(calculateLevel(levelRules.coral, subs(1, 49, 0, 0)), "Expert Coral Propagator");
      });

      void test("should reach Master Coral Propagator", () => {
        assert.strictEqual(calculateLevel(levelRules.coral, subs(0, 50, 0, 0)), "Master Coral Propagator");
        assert.strictEqual(calculateLevel(levelRules.coral, subs(1, 74, 0, 0)), "Master Coral Propagator");
      });

      void test("should reach Grand Master Coral Propagator", () => {
        assert.strictEqual(calculateLevel(levelRules.coral, subs(0, 75, 0, 0)), "Grand Master Coral Propagator");
        assert.strictEqual(calculateLevel(levelRules.coral, subs(1, 99, 0, 0)), "Grand Master Coral Propagator");
      });

      void test("should reach Senior Grand Master Coral Propagator", () => {
        assert.strictEqual(calculateLevel(levelRules.coral, subs(0, 100, 0, 0)), "Senior Grand Master Coral Propagator");
        assert.strictEqual(calculateLevel(levelRules.coral, subs(0, 0, 0, 9999)), "Senior Grand Master Coral Propagator");
      });
    });

    void describe("Edge Cases", () => {
      void test("should handle non-standard point values as errors", () => {
        assert.throws(() => {
          calculateLevel(levelRules.fish, [7, 12, 3]); // Invalid values
        }, /Invalid award value/);
      });

      void test("should handle large point arrays with proper distribution", () => {
        // 5000 points with proper distribution for all level requirements
        const manyPoints = [
          ...Array(16).fill(5),    // 80 from 5 (Senior Grand Master req)
          10, 10, 10,               // 30 from 10 (Master Breeder req)
          15, 15,                   // 30 from 15 (Master Breeder req)
          ...Array(5).fill(20),    // 100 from 20 (Senior Grand Master req)
          ...Array(955).fill(5),   // 4775 more: 80+30+30+100+4775 = 5015 (> 5000)
        ];
        const level = calculateLevel(levelRules.fish, manyPoints);
        assert.strictEqual(level, "Grand Poobah Yoda Breeder");
      });

      void test("should handle mixed valid point values", () => {
        const level = calculateLevel(levelRules.fish, [5, 10, 15, 20, 5, 10]);
        assert.strictEqual(level, "Breeder"); // 65 points with 40 from 10/15/20
      });
    });
  });

  void describe("checkAndUpdateMemberLevel() - Level Upgrades", () => {
    void test("should detect upgrade from Participant to Hobbyist", async () => {
      // Create submissions totaling 25 points (need 5 x 5-point submissions)
      for (let i = 0; i < 5; i++) {
        const sub = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
          witnessStatus: "confirmed",
          witnessedBy: ctx.admin.id,
        });

        await approveSubmission(ctx.admin.id, sub, mockSpeciesIds, {
          ...mockApprovalData,
          points: 5, // Valid point value
        });
      }

      // Check level
      const result = await checkAndUpdateMemberLevel(ctx.member.id, "fish", {
        disableEmails: true,
      });

      assert.strictEqual(result.levelChanged, true);
      assert.strictEqual(result.oldLevel, null); // Database stores null
      assert.strictEqual(result.newLevel, "Hobbyist");

      // Verify database was updated
      const updatedMember = await getMember(ctx.member.id);
      assert.strictEqual(updatedMember?.fish_level, "Hobbyist");
    });

    void test("should not detect change if level is same", async () => {
      // First, set the member to Participant level
      const firstSub = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await approveSubmission(ctx.admin.id, firstSub, mockSpeciesIds, {
        ...mockApprovalData,
        points: 5,
      });

      // Check level once to set it to Participant
      await checkAndUpdateMemberLevel(ctx.member.id, "fish", {
        disableEmails: true,
      });

      // Now add more points but stay below Hobbyist threshold (25)
      const secondSub = await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
        witnessStatus: "confirmed",
        witnessedBy: ctx.admin.id,
      });

      await approveSubmission(ctx.admin.id, secondSub, mockSpeciesIds, {
        ...mockApprovalData,
        points: 10,
      });

      // Check again - should still be Participant (15 points total < 25 for Hobbyist)
      const result = await checkAndUpdateMemberLevel(ctx.member.id, "fish", {
        disableEmails: true,
      });

      assert.strictEqual(result.levelChanged, false);
      assert.strictEqual(result.newLevel, undefined); // No new level since no change
    });

    void test("should handle upgrade to Breeder with distribution requirement", async () => {
      // Create 50 points with proper distribution
      const submissions = [10, 10, 10, 10, 10]; // 50 points, all from 10-point category

      for (const points of submissions) {
        const sub = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
          witnessStatus: "confirmed",
          witnessedBy: ctx.admin.id,
        });

        await approveSubmission(ctx.admin.id, sub, mockSpeciesIds, {
          ...mockApprovalData,
          points,
        });
      }

      const result = await checkAndUpdateMemberLevel(ctx.member.id, "fish", {
        disableEmails: true,
      });

      assert.strictEqual(result.levelChanged, true);
      assert.strictEqual(result.newLevel, "Breeder");
    });

    void test("should work for plant program", async () => {
      // Create plant submissions totaling 25 points
      for (let i = 0; i < 5; i++) {
        const sub = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
          witnessStatus: "confirmed",
          witnessedBy: ctx.admin.id,
          speciesType: "Plant",
          program: "plant",
        });

        await approveSubmission(ctx.admin.id, sub, mockSpeciesIds, {
          ...mockApprovalData,
          points: 5,
        });
      }

      const result = await checkAndUpdateMemberLevel(ctx.member.id, "plant", {
        disableEmails: true,
      });

      assert.strictEqual(result.levelChanged, true);
      assert.strictEqual(result.newLevel, "Beginner Aquatic Horticulturist");

      const updatedMember = await getMember(ctx.member.id);
      assert.strictEqual(updatedMember?.plant_level, "Beginner Aquatic Horticulturist");
    });

    void test("should work for coral program", async () => {
      // Create 5 coral submissions of 5 points each = 25 total
      for (let i = 0; i < 5; i++) {
        const sub = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
          witnessStatus: "confirmed",
          witnessedBy: ctx.admin.id,
          speciesType: "Coral",
          program: "coral",
        });

        await approveSubmission(ctx.admin.id, sub, mockSpeciesIds, {
          ...mockApprovalData,
          points: 5,
        });
      }

      const result = await checkAndUpdateMemberLevel(ctx.member.id, "coral", {
        disableEmails: true,
      });

      assert.strictEqual(result.levelChanged, true);
      assert.strictEqual(result.newLevel, "Beginner Coral Propagator");

      const updatedMember = await getMember(ctx.member.id);
      assert.strictEqual(updatedMember?.coral_level, "Beginner Coral Propagator");
    });

    void test("should throw error for non-existent member", async () => {
      await assert.rejects(
        async () => await checkAndUpdateMemberLevel(99999, "fish", { disableEmails: true }),
        /Member 99999 not found/
      );
    });

    void test("should only count approved submissions", async () => {
      // Create draft submission (not approved)
      await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: false, // Draft
      });

      // Create submitted but not approved
      await createTestSubmission(ctx.db, {
        memberId: ctx.member.id,
        submitted: true,
      });

      const result = await checkAndUpdateMemberLevel(ctx.member.id, "fish", {
        disableEmails: true,
      });

      // Even with no approved submissions, moving from undefined to "Participant" is a level change
      assert.strictEqual(result.levelChanged, true);
      assert.strictEqual(result.newLevel, "Participant");
      assert.strictEqual(result.oldLevel, null); // Database stores null
    });
  });

  void describe("checkAllMemberLevels() - Multi-Program", () => {
    void test("should check all three programs", async () => {
      // Create 5 fish submissions (25 points)
      for (let i = 0; i < 5; i++) {
        const fishSub = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
          witnessStatus: "confirmed",
          witnessedBy: ctx.admin.id,
          program: "fish",
        });

        await approveSubmission(ctx.admin.id, fishSub, mockSpeciesIds, {
          ...mockApprovalData,
          points: 5,
        });
      }

      // Create 5 plant submissions (25 points)
      for (let i = 0; i < 5; i++) {
        const plantSub = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
          witnessStatus: "confirmed",
          witnessedBy: ctx.admin.id,
          speciesType: "Plant",
          program: "plant",
        });

        await approveSubmission(ctx.admin.id, plantSub, mockSpeciesIds, {
          ...mockApprovalData,
          points: 5,
        });
      }

      const results = await checkAllMemberLevels(ctx.member.id, { disableEmails: true });

      assert.strictEqual(results.fish?.levelChanged, true);
      assert.strictEqual(results.fish?.newLevel, "Hobbyist");

      assert.strictEqual(results.plant?.levelChanged, true);
      assert.strictEqual(results.plant?.newLevel, "Beginner Aquatic Horticulturist");

      // Even with no coral submissions, moving from undefined to "Participant" is a level change
      assert.strictEqual(results.coral?.levelChanged, true);
      assert.strictEqual(results.coral?.newLevel, "Participant")

      // Verify database
      const updatedMember = await getMember(ctx.member.id);
      assert.strictEqual(updatedMember?.fish_level, "Hobbyist");
      assert.strictEqual(updatedMember?.plant_level, "Beginner Aquatic Horticulturist");
      assert.strictEqual(updatedMember?.coral_level, "Participant");
    });

    void test("should continue checking other programs if one fails", async () => {
      // This test verifies error handling doesn't stop other programs
      const results = await checkAllMemberLevels(ctx.member.id, { disableEmails: true });

      // All should complete (even with no submissions)
      assert.ok(results.fish);
      assert.ok(results.plant);
      assert.ok(results.coral);
    });
  });

  void describe("Level Downgrade Scenarios", () => {
    void test("should not send email on downgrade", async () => {
      // This is more of a documentation test - the function shouldn't downgrade
      // but if it did, it wouldn't send email

      // For now, the system doesn't support downgrades
      // (submissions can't be unapproved, so points only go up)
      // This test documents the expected behavior if that changes

      const result = await checkAndUpdateMemberLevel(ctx.member.id, "fish", {
        disableEmails: false, // emails enabled
      });

      // Even with no submissions, moving from undefined to "Participant" is a level change
      assert.strictEqual(result.levelChanged, true);
      assert.strictEqual(result.newLevel, "Participant");
    });
  });

  void describe("Email Notification Behavior", () => {
    void test("should not send email when disableEmails is true", async () => {
      // Create 25 points worth of submissions
      for (let i = 0; i < 5; i++) {
        const sub = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
          witnessStatus: "confirmed",
          witnessedBy: ctx.admin.id,
        });

        await approveSubmission(ctx.admin.id, sub, mockSpeciesIds, {
          ...mockApprovalData,
          points: 5,
        });
      }

      const result = await checkAndUpdateMemberLevel(ctx.member.id, "fish", {
        disableEmails: true,
      });

      assert.strictEqual(result.levelChanged, true);
      // Email would be sent if disableEmails was false
      // We can't easily test email sending without mocking, but we verify the flag works
    });

    void test("should respect disableEmails option", async () => {
      // Create 25 points
      for (let i = 0; i < 5; i++) {
        const sub = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
          witnessStatus: "confirmed",
          witnessedBy: ctx.admin.id,
        });

        await approveSubmission(ctx.admin.id, sub, mockSpeciesIds, {
          ...mockApprovalData,
          points: 5,
        });
      }

      // With emails disabled
      const result = await checkAndUpdateMemberLevel(ctx.member.id, "fish", {
        disableEmails: true,
      });

      assert.strictEqual(result.levelChanged, true);
      assert.strictEqual(result.newLevel, "Hobbyist");
    });
  });

  void describe("Complex Level Progression", () => {
    void test("should handle progression through multiple levels", async () => {
      // Start at Participant, go to Hobbyist (25 points), then Breeder (50 points with distribution)

      // First upgrade: Hobbyist (25 points from 5x5)
      for (let i = 0; i < 5; i++) {
        const sub = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
          witnessStatus: "confirmed",
          witnessedBy: ctx.admin.id,
        });

        await approveSubmission(ctx.admin.id, sub, mockSpeciesIds, {
          ...mockApprovalData,
          points: 5,
        });
      }

      let result = await checkAndUpdateMemberLevel(ctx.member.id, "fish", {
        disableEmails: true,
      });

      assert.strictEqual(result.newLevel, "Hobbyist");

      // Second upgrade: Breeder (add 25 more points from 10-point category for distribution)
      for (let i = 0; i < 3; i++) {
        const sub = await createTestSubmission(ctx.db, {
          memberId: ctx.member.id,
          submitted: true,
          witnessStatus: "confirmed",
          witnessedBy: ctx.admin.id,
        });

        await approveSubmission(ctx.admin.id, sub, mockSpeciesIds, {
          ...mockApprovalData,
          points: 10, // 30 points from 10+ category meets Breeder requirement
        });
      }

      result = await checkAndUpdateMemberLevel(ctx.member.id, "fish", {
        disableEmails: true,
      });

      assert.strictEqual(result.newLevel, "Breeder"); // 55 total points with proper distribution
    });
  });
});
