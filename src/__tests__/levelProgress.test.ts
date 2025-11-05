import { describe, test } from "node:test";
import assert from "node:assert";
import { getNextLevel, programMetadata, type ProgramType } from "../programs";

void describe("Level Progress Utilities", () => {
  void describe("getNextLevel()", () => {
    void test("should calculate next level from Participant to Hobbyist (fish)", () => {
      const next = getNextLevel("fish", "Participant", 10);
      assert.ok(next);
      assert.strictEqual(next.name, "Hobbyist");
      assert.strictEqual(next.pointsRequired, 25);
      assert.strictEqual(next.pointsNeeded, 15);
      assert.strictEqual(next.progressPercent, 40);
      assert.strictEqual(next.hasExtraRules, false);
    });

    void test("should calculate next level with extra rules (fish Breeder)", () => {
      const next = getNextLevel("fish", "Hobbyist", 35);
      assert.ok(next);
      assert.strictEqual(next.name, "Breeder");
      assert.strictEqual(next.pointsRequired, 50);
      assert.strictEqual(next.pointsNeeded, 15);
      assert.strictEqual(next.hasExtraRules, true);
      assert.ok(next.extraRulesDescription);
      assert.ok(next.extraRulesDescription.includes("20 points"));
    });

    void test("should return null when at max level (fish)", () => {
      const next = getNextLevel("fish", "Grand Poobah Yoda Breeder", 5000);
      assert.strictEqual(next, null);
    });

    void test("should handle undefined current level (new member)", () => {
      const next = getNextLevel("fish", undefined, 0);
      assert.ok(next);
      assert.strictEqual(next.name, "Hobbyist");
      assert.strictEqual(next.pointsNeeded, 25);
    });

    void test("should calculate progress for plant program", () => {
      const next = getNextLevel("plant", "Beginner Aquatic Horticulturist", 40);
      assert.ok(next);
      assert.strictEqual(next.name, "Aquatic Horticulturist");
      assert.strictEqual(next.pointsRequired, 50);
      assert.strictEqual(next.pointsNeeded, 10);
      assert.strictEqual(next.progressPercent, 80);
    });

    void test("should calculate progress for coral program", () => {
      const next = getNextLevel("coral", "Participant", 15);
      assert.ok(next);
      assert.strictEqual(next.name, "Beginner Coral Propagator");
      assert.strictEqual(next.pointsRequired, 25);
      assert.strictEqual(next.pointsNeeded, 10);
      assert.strictEqual(next.progressPercent, 60);
    });

    void test("should handle max level for plant program", () => {
      const next = getNextLevel("plant", "Senior Premier Aquatic Horticulturist", 3000);
      assert.strictEqual(next, null);
    });

    void test("should handle max level for coral program", () => {
      const next = getNextLevel("coral", "Senior Grand Master Coral Propagator", 2000);
      assert.strictEqual(next, null);
    });

    void test("should calculate 100% progress when at next level threshold", () => {
      const next = getNextLevel("fish", "Participant", 25);
      assert.ok(next);
      assert.strictEqual(next.progressPercent, 100);
      assert.strictEqual(next.pointsNeeded, 0);
    });

    void test("should show extra rules for Advanced Breeder", () => {
      const next = getNextLevel("fish", "Breeder", 75);
      assert.ok(next);
      assert.strictEqual(next.name, "Advanced Breeder");
      assert.strictEqual(next.hasExtraRules, true);
      assert.ok(next.extraRulesDescription);
      assert.ok(next.extraRulesDescription.includes("40 points"));
    });
  });

  void describe("programMetadata", () => {
    void test("should have metadata for all programs", () => {
      const programs: ProgramType[] = ["fish", "plant", "coral"];

      for (const program of programs) {
        const meta = programMetadata[program];
        assert.ok(meta);
        assert.ok(meta.name);
        assert.ok(meta.icon);
        assert.ok(meta.badge);
        assert.ok(meta.border);
        assert.ok(meta.accent);
      }
    });

    void test("should have correct icons", () => {
      assert.strictEqual(programMetadata.fish.icon, "🐠");
      assert.strictEqual(programMetadata.plant.icon, "🌱");
      assert.strictEqual(programMetadata.coral.icon, "🪸");
    });

    void test("should have program-specific colors", () => {
      assert.ok(programMetadata.fish.badge.includes("blue"));
      assert.ok(programMetadata.plant.badge.includes("green"));
      assert.ok(programMetadata.coral.badge.includes("purple"));
    });
  });
});
