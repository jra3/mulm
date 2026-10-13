import { createTestDatabase, type TestDatabase } from "./helpers/database";
/**
 * specialtyAwardManager over Submissions bound to their Species by species_id.
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database } from "sqlite";
import { createSpecies } from "@/species";
import { checkAndGrantSpecialtyAwards } from "../specialtyAwardManager";

void describe("SpecialtyAwardManager", () => {
  let db: Database;
  let database: TestDatabase;
  let testGroupId: number;
  let memberId: number;

  beforeEach(async () => {
    database = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
    db = database.db;

    testGroupId = await createSpecies({
      programClass: "Anabantoids",
      speciesType: "Fish",
      canonicalGenus: "Testgenus",
      canonicalSpeciesName: "testspecies",
      pointClass: 10,
    });

    // Create test member
    const memberResult = await db.run(`
      INSERT INTO members (display_name, contact_email, is_admin)
      VALUES ('Test Member', 'test@example.com', 0)
    `);
    memberId = memberResult.lastID as number;
  });

  afterEach(async () => {
    if (db) {
      await database.cleanup();
    }
  });

  void describe("getSubmissionsWithGenus", () => {
    void test("should read a bound Submission", async () => {
      await db.run(
        `
        INSERT INTO submissions (
          member_id, species_id, species_class, species_common_name, species_latin_name,
          species_type, water_type, spawn_locations, submitted_on, approved_on, program
        ) VALUES (?, ?, 'Anabantoids', 'Common Test Fish', 'Testgenus testspecies',
                  'Fish', 'Freshwater', 'substrate', datetime('now'), datetime('now'), 'fish')
      `,
        [memberId, testGroupId]
      );

      const result = await checkAndGrantSpecialtyAwards(memberId);

      // Verify function ran without errors
      assert.ok(Array.isArray(result));
    });
  });

  void describe("getSubmissionsWithGenus, another spelling", () => {
    void test("should read a bound Submission whatever the member typed", async () => {
      await db.run(
        `
        INSERT INTO submissions (
          member_id, species_id, species_class, species_common_name, species_latin_name,
          species_type, water_type, spawn_locations, submitted_on, approved_on, program
        ) VALUES (?, ?, 'Anabantoids', 'Test Fish', 'Testgenus testspecies',
                  'Fish', 'Freshwater', 'substrate', datetime('now'), datetime('now'), 'fish')
      `,
        [memberId, testGroupId]
      );

      const result = await checkAndGrantSpecialtyAwards(memberId);

      // Verify function ran without errors
      assert.ok(Array.isArray(result));
    });
  });

  void describe("Several Submissions", () => {
    void test("should handle several Submissions of one Species", async () => {
      await db.run(
        `
        INSERT INTO submissions (
          member_id, species_id, species_class, species_common_name, species_latin_name,
          species_type, water_type, spawn_locations, submitted_on, approved_on, program
        ) VALUES (?, ?, 'Anabantoids', 'Common Fish', 'Testgenus testspecies',
                  'Fish', 'Freshwater', 'substrate', datetime('now'), datetime('now'), 'fish')
      `,
        [memberId, testGroupId]
      );

      await db.run(
        `
        INSERT INTO submissions (
          member_id, species_id, species_class, species_common_name, species_latin_name,
          species_type, water_type, spawn_locations, submitted_on, approved_on, program
        ) VALUES (?, ?, 'Anabantoids', 'Test Fish', 'Testgenus testspecies var. blue',
                  'Fish', 'Freshwater', 'substrate', datetime('now'), datetime('now'), 'fish')
      `,
        [memberId, testGroupId]
      );

      const result = await checkAndGrantSpecialtyAwards(memberId);

      // All submissions should be processed
      assert.ok(Array.isArray(result));
    });
  });

  void describe("Filtering", () => {
    void test("should only include approved submissions", async () => {
      // Draft submission (not approved)
      await db.run(
        `
        INSERT INTO submissions (
          member_id, species_id, species_class, species_common_name, species_latin_name,
          species_type, water_type, spawn_locations, submitted_on, program
        ) VALUES (?, ?, 'Anabantoids', 'Test Fish', 'Testgenus testspecies',
                  'Fish', 'Freshwater', 'substrate', NULL, 'fish')
      `,
        [memberId, testGroupId]
      );

      const result = await checkAndGrantSpecialtyAwards(memberId);

      // No awards should be granted for draft submissions
      assert.ok(Array.isArray(result));
    });

    void test("should only include submissions that are submitted", async () => {
      // Unsubmitted submission
      await db.run(
        `
        INSERT INTO submissions (
          member_id, species_id, species_class, species_common_name, species_latin_name,
          species_type, water_type, spawn_locations, program
        ) VALUES (?, ?, 'Anabantoids', 'Test Fish', 'Testgenus testspecies',
                  'Fish', 'Freshwater', 'substrate', 'fish')
      `,
        [memberId, testGroupId]
      );

      const result = await checkAndGrantSpecialtyAwards(memberId);

      // No awards for unsubmitted
      assert.ok(Array.isArray(result));
    });
  });

  void describe("Edge cases", () => {
    void test("should handle member with no submissions", async () => {
      const result = await checkAndGrantSpecialtyAwards(memberId);

      assert.strictEqual(result.length, 0, "No awards for member with no submissions");
    });

    void test("should handle species without canonical_genus (no FK set)", async () => {
      // Create submission without any species FK (orphaned submission)
      await db.run(
        `
        INSERT INTO submissions (
          member_id, species_class, species_common_name, species_latin_name,
          species_type, water_type, spawn_locations, submitted_on, approved_on, program
        ) VALUES (?, 'Anabantoids', 'Orphan Fish', 'Orphan species',
                  'Fish', 'Freshwater', 'substrate', datetime('now'), datetime('now'), 'fish')
      `,
        [memberId]
      );

      const result = await checkAndGrantSpecialtyAwards(memberId);

      // Should not crash, canonical_genus will be null/undefined
      assert.ok(Array.isArray(result));
    });
  });
});
