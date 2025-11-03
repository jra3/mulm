/**
 * Test suite for specialty awards progress calculation
 * Tests the getSpecialtyAwardProgress function that powers the member page progress UI
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import { getSpecialtyAwardProgress } from "../db/members";
import { createSpeciesGroup, addCommonName, addScientificName } from "../db/species";

void describe("Specialty Awards Progress Calculation", () => {
  let db: Database;
  let memberId: number;
  let anabantoidSpeciesId: number;
  let catfishCorydorasId: number;
  let catfishNonCorydorasId: number;

  beforeEach(async () => {
    db = await open({
      filename: ":memory:",
      driver: sqlite3.Database,
    });

    await db.exec("PRAGMA foreign_keys = ON;");
    await db.migrate({ migrationsPath: "./db/migrations" });
    overrideConnection(db);

    // Create test member
    const timestamp = Date.now();
    const memberResult = await db.run(`
      INSERT INTO members (display_name, contact_email, is_admin)
      VALUES (?, ?, 0)
    `, [`Test Member ${timestamp}`, `test${timestamp}@example.com`]);
    memberId = memberResult.lastID as number;

    // Create test species groups with unique names
    anabantoidSpeciesId = await createSpeciesGroup({
      programClass: "Anabantoids",
      speciesType: "Fish",
      canonicalGenus: "Betta",
      canonicalSpeciesName: `splendens${timestamp}`,
      basePoints: 5,
    });

    catfishCorydorasId = await createSpeciesGroup({
      programClass: "Catfish & Loaches",
      speciesType: "Fish",
      canonicalGenus: "Corydoras",
      canonicalSpeciesName: `paleatus${timestamp}`,
      basePoints: 5,
    });

    catfishNonCorydorasId = await createSpeciesGroup({
      programClass: "Catfish & Loaches",
      speciesType: "Fish",
      canonicalGenus: "Ancistrus",
      canonicalSpeciesName: `sp${timestamp}`,
      basePoints: 10,
    });

    // Add names to species groups
    await addCommonName(anabantoidSpeciesId, "Betta splendens", "Siamese Fighting Fish");
    await addScientificName(anabantoidSpeciesId, "Betta splendens");

    await addCommonName(catfishCorydorasId, "Corydoras paleatus", "Peppered Cory");
    await addScientificName(catfishCorydorasId, "Corydoras paleatus");

    await addCommonName(catfishNonCorydorasId, "Ancistrus sp.", "Bristlenose Pleco");
    await addScientificName(catfishNonCorydorasId, "Ancistrus sp.");
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  void test("returns empty progress for member with no submissions", async () => {
    const progress = await getSpecialtyAwardProgress(memberId);

    assert.strictEqual(progress.awards.length, 11, "Should have 11 specialty awards");
    assert.strictEqual(progress.totalCompleted, 0, "Should have 0 completed awards");

    // All awards should show 0 progress
    for (const award of progress.awards) {
      assert.strictEqual(award.currentSpecies, 0, `${award.awardName} should have 0 species`);
      assert.strictEqual(award.isComplete, false, `${award.awardName} should not be complete`);
      assert.strictEqual(award.isGranted, false, `${award.awardName} should not be granted`);
    }
  });

  void test("calculates basic progress for Anabantoids", async () => {
    // Create approved submission for Anabantoid
    const commonNameResult = await db.get(
      "SELECT common_name_id FROM species_common_name WHERE group_id = ?",
      [anabantoidSpeciesId]
    );
    const scientificNameResult = await db.get(
      "SELECT scientific_name_id FROM species_scientific_name WHERE group_id = ?",
      [anabantoidSpeciesId]
    );

    await db.run(
      `
      INSERT INTO submissions (
        member_id, program, species_type, species_class, species_common_name, species_latin_name,
        common_name_id, scientific_name_id, water_type, count, reproduction_date,
        foods, spawn_locations, submitted_on, approved_on, points
      ) VALUES (?, 'fish', 'Fish', 'Anabantoids', 'Siamese Fighting Fish', 'Betta splendens',
        ?, ?, 'Fresh', '20', '2024-01-01', 'Frozen', 'Plants', datetime('now'), datetime('now'), 5)
    `,
      [memberId, commonNameResult.common_name_id, scientificNameResult.scientific_name_id]
    );

    const progress = await getSpecialtyAwardProgress(memberId);

    const anabantoidAward = progress.awards.find((a) => a.awardName === "Anabantoids Specialist");
    assert.ok(anabantoidAward, "Should find Anabantoids Specialist award");
    assert.strictEqual(anabantoidAward.currentSpecies, 1, "Should have 1 species");
    assert.strictEqual(anabantoidAward.requiredSpecies, 6, "Should require 6 species");
    assert.strictEqual(
      anabantoidAward.percentComplete,
      17,
      "Should be 17% complete (1/6 rounded)"
    );
    assert.strictEqual(anabantoidAward.isComplete, false, "Should not be complete yet");
    assert.strictEqual(progress.totalCompleted, 0, "Should have 0 completed awards");
  });

  void test("handles Catfish special requirement (non-Corydoras)", async () => {
    // Add only Corydoras submissions (4 of them)
    const corydorasCommonName = await db.get(
      "SELECT common_name_id FROM species_common_name WHERE group_id = ?",
      [catfishCorydorasId]
    );
    const corydorasScientificName = await db.get(
      "SELECT scientific_name_id FROM species_scientific_name WHERE group_id = ?",
      [catfishCorydorasId]
    );

    for (let i = 0; i < 4; i++) {
      await db.run(
        `
        INSERT INTO submissions (
          member_id, program, species_type, species_class, species_common_name, species_latin_name,
          common_name_id, scientific_name_id, water_type, count, reproduction_date,
          foods, spawn_locations, submitted_on, approved_on, points
        ) VALUES (?, 'fish', 'Fish', 'Catfish & Loaches', 'Peppered Cory', 'Corydoras paleatus',
          ?, ?, 'Fresh', '20', '2024-01-01', 'Frozen', 'Plants', datetime('now'), datetime('now'), 5)
      `,
        [memberId, corydorasCommonName.common_name_id, corydorasScientificName.scientific_name_id]
      );
    }

    let progress = await getSpecialtyAwardProgress(memberId);
    let catfishAward = progress.awards.find((a) => a.awardName === "Catfish Specialist");

    assert.ok(catfishAward, "Should find Catfish Specialist award");
    assert.strictEqual(catfishAward.currentSpecies, 1, "Should count 1 unique species");
    assert.strictEqual(catfishAward.isComplete, false, "Should not be complete (needs 5 species)");
    assert.ok(catfishAward.specialRequirement, "Should have special requirement");
    assert.strictEqual(
      catfishAward.specialRequirement?.isMet,
      false,
      "Special requirement not met (all Corydoras)"
    );

    // Now add a non-Corydoras catfish and reach 5 species total
    const ancistrusCommonName = await db.get(
      "SELECT common_name_id FROM species_common_name WHERE group_id = ?",
      [catfishNonCorydorasId]
    );
    const ancistrusScientificName = await db.get(
      "SELECT scientific_name_id FROM species_scientific_name WHERE group_id = ?",
      [catfishNonCorydorasId]
    );

    await db.run(
      `
      INSERT INTO submissions (
        member_id, program, species_type, species_class, species_common_name, species_latin_name,
        common_name_id, scientific_name_id, water_type, count, reproduction_date,
        foods, spawn_locations, submitted_on, approved_on, points
      ) VALUES (?, 'fish', 'Fish', 'Catfish & Loaches', 'Bristlenose Pleco', 'Ancistrus sp.',
        ?, ?, 'Fresh', '20', '2024-01-01', 'Frozen', 'Plants', datetime('now'), datetime('now'), 10)
    `,
      [memberId, ancistrusCommonName.common_name_id, ancistrusScientificName.scientific_name_id]
    );

    // Add 3 more unique Corydoras species to reach 5 total
    for (let i = 2; i <= 4; i++) {
      const newCorydorasId = await createSpeciesGroup({
        programClass: "Catfish & Loaches",
        speciesType: "Fish",
        canonicalGenus: "Corydoras",
        canonicalSpeciesName: `species${i}`,
        basePoints: 5,
      });

      await addCommonName(newCorydorasId, `Corydoras species${i}`, `Cory ${i}`);
      await addScientificName(newCorydorasId, `Corydoras species${i}`);

      const newCommonName = await db.get(
        "SELECT common_name_id FROM species_common_name WHERE group_id = ?",
        [newCorydorasId]
      );
      const newScientificName = await db.get(
        "SELECT scientific_name_id FROM species_scientific_name WHERE group_id = ?",
        [newCorydorasId]
      );

      await db.run(
        `
        INSERT INTO submissions (
          member_id, program, species_type, species_class, species_common_name, species_latin_name,
          common_name_id, scientific_name_id, water_type, count, reproduction_date,
          foods, spawn_locations, submitted_on, approved_on, points
        ) VALUES (?, 'fish', 'Fish', 'Catfish & Loaches', ?, ?,
          ?, ?, 'Fresh', '20', '2024-01-01', 'Frozen', 'Plants', datetime('now'), datetime('now'), 5)
      `,
        [
          memberId,
          `Cory ${i}`,
          `Corydoras species${i}`,
          newCommonName.common_name_id,
          newScientificName.scientific_name_id,
        ]
      );
    }

    progress = await getSpecialtyAwardProgress(memberId);
    catfishAward = progress.awards.find((a) => a.awardName === "Catfish Specialist");

    assert.ok(catfishAward, "Should find Catfish Specialist award");
    assert.strictEqual(catfishAward.currentSpecies, 5, "Should have 5 unique species");
    assert.strictEqual(catfishAward.isComplete, true, "Should be complete");
    assert.strictEqual(
      catfishAward.specialRequirement?.isMet,
      true,
      "Special requirement met (has non-Corydoras)"
    );
  });

  void test("marks granted awards correctly", async () => {
    // Create an awarded Anabantoid specialist
    await db.run(
      "INSERT INTO awards (member_id, award_name, date_awarded, award_type) VALUES (?, ?, datetime('now'), 'species')",
      [memberId, "Anabantoids Specialist"]
    );

    const progress = await getSpecialtyAwardProgress(memberId);

    const anabantoidAward = progress.awards.find((a) => a.awardName === "Anabantoids Specialist");
    assert.ok(anabantoidAward, "Should find Anabantoids Specialist award");
    assert.strictEqual(anabantoidAward.isGranted, true, "Should be marked as granted");
  });

  void test("calculates meta-award progress", async () => {
    // Grant 3 specialty awards
    const awardNames = [
      "Anabantoids Specialist",
      "Catfish Specialist",
      "Characins Specialist",
    ];

    for (const awardName of awardNames) {
      await db.run(
        "INSERT INTO awards (member_id, award_name, date_awarded, award_type) VALUES (?, ?, datetime('now'), 'species')",
        [memberId, awardName]
      );
    }

    const progress = await getSpecialtyAwardProgress(memberId);

    assert.strictEqual(
      progress.metaAwards.seniorSpecialist.current,
      3,
      "Should count 3 towards Senior Specialist"
    );
    assert.strictEqual(
      progress.metaAwards.seniorSpecialist.required,
      4,
      "Should require 4 for Senior Specialist"
    );
    assert.strictEqual(
      progress.metaAwards.seniorSpecialist.isGranted,
      false,
      "Should not be granted yet"
    );

    // Add one more to reach Senior Specialist
    await db.run(
      "INSERT INTO awards (member_id, award_name, date_awarded, award_type) VALUES (?, ?, datetime('now'), 'species')",
      [memberId, "Cyprinids Specialist"]
    );

    const progress2 = await getSpecialtyAwardProgress(memberId);
    assert.strictEqual(
      progress2.metaAwards.seniorSpecialist.current,
      4,
      "Should count 4 towards Senior Specialist"
    );
  });

  void test("excludes Marine Invertebrates from meta-award count", async () => {
    // Grant 4 specialty awards including Marine Invertebrates
    const awardNames = [
      "Anabantoids Specialist",
      "Catfish Specialist",
      "Characins Specialist",
      "Marine Invertebrates & Corals Specialist", // This one shouldn't count
    ];

    for (const awardName of awardNames) {
      await db.run(
        "INSERT INTO awards (member_id, award_name, date_awarded, award_type) VALUES (?, ?, datetime('now'), 'species')",
        [memberId, awardName]
      );
    }

    const progress = await getSpecialtyAwardProgress(memberId);

    // Should only count 3 (excluding Marine Invertebrates)
    assert.strictEqual(
      progress.metaAwards.seniorSpecialist.current,
      3,
      "Should count 3 (excluding Marine Invertebrates)"
    );
    assert.strictEqual(
      progress.metaAwards.expertSpecialist.current,
      3,
      "Should count 3 towards Expert Specialist"
    );
  });

  void test("counts unique species correctly (case-insensitive)", async () => {
    // Add the same species twice with different cases
    const commonNameResult = await db.get(
      "SELECT common_name_id FROM species_common_name WHERE group_id = ?",
      [anabantoidSpeciesId]
    );
    const scientificNameResult = await db.get(
      "SELECT scientific_name_id FROM species_scientific_name WHERE group_id = ?",
      [anabantoidSpeciesId]
    );

    // First submission
    await db.run(
      `
      INSERT INTO submissions (
        member_id, program, species_type, species_class, species_common_name, species_latin_name,
        common_name_id, scientific_name_id, water_type, count, reproduction_date,
        foods, spawn_locations, submitted_on, approved_on, points
      ) VALUES (?, 'fish', 'Fish', 'Anabantoids', 'Siamese Fighting Fish', 'Betta splendens',
        ?, ?, 'Fresh', '20', '2024-01-01', 'Frozen', 'Plants', datetime('now'), datetime('now'), 5)
    `,
      [memberId, commonNameResult.common_name_id, scientificNameResult.scientific_name_id]
    );

    // Second submission (same species, should not count twice)
    await db.run(
      `
      INSERT INTO submissions (
        member_id, program, species_type, species_class, species_common_name, species_latin_name,
        common_name_id, scientific_name_id, water_type, count, reproduction_date,
        foods, spawn_locations, submitted_on, approved_on, points
      ) VALUES (?, 'fish', 'Fish', 'Anabantoids', 'Siamese Fighting Fish', 'BETTA SPLENDENS',
        ?, ?, 'Fresh', '30', '2024-02-01', 'Live', 'Cave', datetime('now'), datetime('now'), 5)
    `,
      [memberId, commonNameResult.common_name_id, scientificNameResult.scientific_name_id]
    );

    const progress = await getSpecialtyAwardProgress(memberId);

    const anabantoidAward = progress.awards.find((a) => a.awardName === "Anabantoids Specialist");
    assert.strictEqual(
      anabantoidAward?.currentSpecies,
      1,
      "Should count only 1 unique species (case-insensitive)"
    );
    assert.strictEqual(
      anabantoidAward?.speciesBred.length,
      1,
      "Should list only 1 species in bred list"
    );
  });
});
