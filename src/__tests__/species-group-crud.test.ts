import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import {
  createSpeciesGroup,
  updateSpeciesGroup,
  deleteSpeciesGroup,
  bulkSetPoints,
  addCommonName,
  addScientificName,
  getNamesForGroup,
} from "../db/species";

describe("Species Group CRUD Operations", () => {
  let db: Database;
  let testGroupId: number;

  beforeEach(async () => {
    db = await open({
      filename: ":memory:",
      driver: sqlite3.Database,
    });

    await db.exec("PRAGMA foreign_keys = ON;");
    await db.migrate({ migrationsPath: "./db/migrations" });
    overrideConnection(db);

    // Create test species group
    const result = await db.run(`
      INSERT INTO species_name_group (
        program_class, species_type, canonical_genus, canonical_species_name,
        base_points, is_cares_species
      ) VALUES ('Livebearers', 'Fish', 'Testicus', 'groupus', 10, 1)
    `);
    testGroupId = result.lastID as number;

    // Add a common and scientific name
    await addCommonName(testGroupId, "Test Fish");
    await addScientificName(testGroupId, "Testicus groupus");
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("createSpeciesGroup", () => {
    test("should create a new species group and return group_id", async () => {
      const groupId = await createSpeciesGroup({
        programClass: "Characins",
        speciesType: "Fish",
        canonicalGenus: "Newgenus",
        canonicalSpeciesName: "newspecies",
        basePoints: 15,
        isCaresSpecies: true,
      });

      assert.ok(groupId > 0, "Should return positive group_id");

      const created = await db.get("SELECT * FROM species_name_group WHERE group_id = ?", [
        groupId,
      ]);

      assert.strictEqual(created.canonical_genus, "Newgenus");
      assert.strictEqual(created.canonical_species_name, "newspecies");
      assert.strictEqual(created.species_type, "Fish");
      assert.strictEqual(created.program_class, "Characins");
      assert.strictEqual(created.base_points, 15);
      assert.strictEqual(created.is_cares_species, 1);
    });

    test("should create with minimal required fields", async () => {
      const groupId = await createSpeciesGroup({
        programClass: "Killifish",
        speciesType: "Fish",
        canonicalGenus: "Minimal",
        canonicalSpeciesName: "species",
      });

      const created = await db.get("SELECT * FROM species_name_group WHERE group_id = ?", [
        groupId,
      ]);

      assert.ok(created);
      assert.strictEqual(created.base_points, null);
      assert.strictEqual(created.is_cares_species, 0);
    });

    test("should trim whitespace from inputs", async () => {
      const groupId = await createSpeciesGroup({
        programClass: "  Trimmed  ",
        speciesType: "Plant",
        canonicalGenus: "  Genus  ",
        canonicalSpeciesName: "  species  ",
      });

      const created = await db.get("SELECT * FROM species_name_group WHERE group_id = ?", [
        groupId,
      ]);

      assert.strictEqual(created.canonical_genus, "Genus");
      assert.strictEqual(created.canonical_species_name, "species");
      assert.strictEqual(created.program_class, "Trimmed");
    });

    test("should throw error for empty canonical genus", async () => {
      await assert.rejects(
        async () =>
          await createSpeciesGroup({
            programClass: "Test",
            speciesType: "Fish",
            canonicalGenus: "",
            canonicalSpeciesName: "species",
          }),
        { message: /cannot be empty/ }
      );
    });

    test("should throw error for empty canonical species name", async () => {
      await assert.rejects(
        async () =>
          await createSpeciesGroup({
            programClass: "Test",
            speciesType: "Fish",
            canonicalGenus: "Genus",
            canonicalSpeciesName: "   ",
          }),
        { message: /cannot be empty/ }
      );
    });

    test("should throw error for empty program class", async () => {
      await assert.rejects(
        async () =>
          await createSpeciesGroup({
            programClass: "",
            speciesType: "Fish",
            canonicalGenus: "Genus",
            canonicalSpeciesName: "species",
          }),
        { message: /cannot be empty/ }
      );
    });

    test("should throw error for invalid species type", async () => {
      await assert.rejects(
        async () =>
          await createSpeciesGroup({
            programClass: "Test",
            speciesType: "Invalid" as any,
            canonicalGenus: "Genus",
            canonicalSpeciesName: "species",
          }),
        { message: /must be Fish, Plant, Invert, or Coral/ }
      );
    });

    test("should throw error for points out of range", async () => {
      await assert.rejects(
        async () =>
          await createSpeciesGroup({
            programClass: "Test",
            speciesType: "Fish",
            canonicalGenus: "Genus",
            canonicalSpeciesName: "species",
            basePoints: 101,
          }),
        { message: /between 0 and 100/ }
      );
    });

    test("should throw error for duplicate canonical name", async () => {
      await createSpeciesGroup({
        programClass: "Cichlids",
        speciesType: "Fish",
        canonicalGenus: "Duplicate",
        canonicalSpeciesName: "test",
      });

      await assert.rejects(
        async () =>
          await createSpeciesGroup({
            programClass: "Livebearers",
            speciesType: "Fish",
            canonicalGenus: "Duplicate",
            canonicalSpeciesName: "test",
          }),
        { message: /already exists/ }
      );
    });

    test("should allow same genus with different species", async () => {
      const id1 = await createSpeciesGroup({
        programClass: "Cichlids",
        speciesType: "Fish",
        canonicalGenus: "Samegenus",
        canonicalSpeciesName: "species1",
      });

      const id2 = await createSpeciesGroup({
        programClass: "Cichlids",
        speciesType: "Fish",
        canonicalGenus: "Samegenus",
        canonicalSpeciesName: "species2",
      });

      assert.ok(id1 !== id2, "Should create two different species");
    });

    test("should allow same species name with different genus", async () => {
      const id1 = await createSpeciesGroup({
        programClass: "Cichlids",
        speciesType: "Fish",
        canonicalGenus: "Genus1",
        canonicalSpeciesName: "samespecies",
      });

      const id2 = await createSpeciesGroup({
        programClass: "Cichlids",
        speciesType: "Fish",
        canonicalGenus: "Genus2",
        canonicalSpeciesName: "samespecies",
      });

      assert.ok(id1 !== id2);
    });

    test("should accept all valid species types", async () => {
      const fish = await createSpeciesGroup({
        programClass: "Cichlids",
        speciesType: "Fish",
        canonicalGenus: "TypeTest",
        canonicalSpeciesName: "fish",
      });

      const plant = await createSpeciesGroup({
        programClass: "Stem Plants",
        speciesType: "Plant",
        canonicalGenus: "TypeTest",
        canonicalSpeciesName: "plant",
      });

      const invert = await createSpeciesGroup({
        programClass: "Shrimp",
        speciesType: "Invert",
        canonicalGenus: "TypeTest",
        canonicalSpeciesName: "invert",
      });

      const coral = await createSpeciesGroup({
        programClass: "Hard",
        speciesType: "Coral",
        canonicalGenus: "TypeTest",
        canonicalSpeciesName: "coral",
      });

      assert.ok(fish && plant && invert && coral, "All species types should work");
    });
  });

  describe("updateSpeciesGroup", () => {
    test("should update canonical genus", async () => {
      const changes = await updateSpeciesGroup(testGroupId, {
        canonicalGenus: "Newgenus",
      });

      assert.strictEqual(changes, 1);

      const updated = await db.get("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated.canonical_genus, "Newgenus");
      assert.strictEqual(updated.canonical_species_name, "groupus"); // Unchanged
    });

    test("should update canonical species name", async () => {
      const changes = await updateSpeciesGroup(testGroupId, {
        canonicalSpeciesName: "newspecies",
      });

      assert.strictEqual(changes, 1);

      const updated = await db.get("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated.canonical_species_name, "newspecies");
      assert.strictEqual(updated.canonical_genus, "Testicus"); // Unchanged
    });

    test("should update species type", async () => {
      const changes = await updateSpeciesGroup(testGroupId, {
        speciesType: "Plant",
      });

      assert.strictEqual(changes, 1);

      const updated = await db.get("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated.species_type, "Plant");
    });

    test("should update program class", async () => {
      const changes = await updateSpeciesGroup(testGroupId, {
        programClass: "Cichlids",
      });

      assert.strictEqual(changes, 1);

      const updated = await db.get("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated.program_class, "Cichlids");
    });

    test("should update base points", async () => {
      const changes = await updateSpeciesGroup(testGroupId, {
        basePoints: 25,
      });

      assert.strictEqual(changes, 1);

      const updated = await db.get("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated.base_points, 25);
    });

    test("should set base points to null", async () => {
      const changes = await updateSpeciesGroup(testGroupId, {
        basePoints: null,
      });

      assert.strictEqual(changes, 1);

      const updated = await db.get("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated.base_points, null);
    });

    test("should update CARES status", async () => {
      const changes = await updateSpeciesGroup(testGroupId, {
        isCaresSpecies: false,
      });

      assert.strictEqual(changes, 1);

      const updated = await db.get("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated.is_cares_species, 0);
    });

    test("should update external references", async () => {
      const refs = ["https://fishbase.org/test", "https://wikipedia.org/test"];
      const changes = await updateSpeciesGroup(testGroupId, {
        externalReferences: refs,
      });

      assert.strictEqual(changes, 1);

      const updated = await db.get("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.deepStrictEqual(JSON.parse(updated.external_references), refs);
    });

    test("should clear external references with empty array", async () => {
      const changes = await updateSpeciesGroup(testGroupId, {
        externalReferences: [],
      });

      assert.strictEqual(changes, 1);

      const updated = await db.get("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated.external_references, null);
    });

    test("should update multiple fields at once", async () => {
      const changes = await updateSpeciesGroup(testGroupId, {
        canonicalGenus: "Multiupdate",
        basePoints: 50,
        isCaresSpecies: false,
        programClass: "Characins",
      });

      assert.strictEqual(changes, 1);

      const updated = await db.get("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated.canonical_genus, "Multiupdate");
      assert.strictEqual(updated.base_points, 50);
      assert.strictEqual(updated.is_cares_species, 0);
      assert.strictEqual(updated.program_class, "Characins");
    });

    test("should trim whitespace from string fields", async () => {
      const changes = await updateSpeciesGroup(testGroupId, {
        canonicalGenus: "  Whitespace  ",
        programClass: "  Trimmed  ",
      });

      assert.strictEqual(changes, 1);

      const updated = await db.get("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated.canonical_genus, "Whitespace");
      assert.strictEqual(updated.program_class, "Trimmed");
    });

    test("should return 0 for non-existent group_id", async () => {
      const changes = await updateSpeciesGroup(99999, {
        basePoints: 10,
      });

      assert.strictEqual(changes, 0);
    });

    test("should throw error for empty canonical genus", async () => {
      await assert.rejects(
        async () => await updateSpeciesGroup(testGroupId, { canonicalGenus: "" }),
        { message: /cannot be empty/ }
      );

      await assert.rejects(
        async () => await updateSpeciesGroup(testGroupId, { canonicalGenus: "   " }),
        { message: /cannot be empty/ }
      );
    });

    test("should throw error for empty canonical species name", async () => {
      await assert.rejects(
        async () => await updateSpeciesGroup(testGroupId, { canonicalSpeciesName: "" }),
        { message: /cannot be empty/ }
      );
    });

    test("should throw error for invalid species type", async () => {
      await assert.rejects(
        async () => await updateSpeciesGroup(testGroupId, { speciesType: "InvalidType" as any }),
        { message: /must be Fish, Plant, Invert, or Coral/ }
      );
    });

    test("should throw error for points out of range", async () => {
      await assert.rejects(async () => await updateSpeciesGroup(testGroupId, { basePoints: -1 }), {
        message: /between 0 and 100/,
      });

      await assert.rejects(async () => await updateSpeciesGroup(testGroupId, { basePoints: 101 }), {
        message: /between 0 and 100/,
      });
    });

    test("should throw error for empty updates object", async () => {
      await assert.rejects(async () => await updateSpeciesGroup(testGroupId, {}), {
        message: /at least one field/i,
      });
    });

    test("should throw error for duplicate canonical name", async () => {
      // Create another species
      const other = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids', 'Fish', 'Existing', 'species')
      `);

      await assert.rejects(
        async () =>
          await updateSpeciesGroup(testGroupId, {
            canonicalGenus: "Existing",
            canonicalSpeciesName: "species",
          }),
        { message: /already exists/ }
      );
    });
  });

  describe("deleteSpeciesGroup", () => {
    test("should delete species group and return 1", async () => {
      const changes = await deleteSpeciesGroup(testGroupId);

      assert.strictEqual(changes, 1);

      const result = await db.get("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(result, undefined, "Species group should be deleted");
    });

    test("should cascade delete all synonyms (FK constraint)", async () => {
      await addCommonName(testGroupId, "Second Name");
      await addScientificName(testGroupId, "Testicus groupus variant");

      const beforeNames = await getNamesForGroup(testGroupId);
      assert.strictEqual(beforeNames.common_names.length + beforeNames.scientific_names.length, 4);

      await deleteSpeciesGroup(testGroupId);

      const afterNames = await getNamesForGroup(testGroupId);
      assert.strictEqual(
        afterNames.common_names.length + afterNames.scientific_names.length,
        0,
        "All names should be deleted"
      );
    });

    test("should throw error for non-existent group_id", async () => {
      // The function checks if group exists before attempting delete
      await assert.rejects(async () => await deleteSpeciesGroup(99999), { message: /not found/ });
    });

    test("should prevent deleting species with approved submissions", async () => {
      // Create member
      const memberResult = await db.run(`
        INSERT INTO members (display_name, contact_email)
        VALUES ('Test Member', 'test@example.com')
      `);
      const memberId = memberResult.lastID as number;

      // Get the common and scientific name IDs we created in beforeEach
      const names = await getNamesForGroup(testGroupId);
      const commonNameId = names.common_names[0]?.common_name_id;
      const scientificNameId = names.scientific_names[0]?.scientific_name_id;

      // Create approved submission using split schema FKs
      await db.run(
        `
        INSERT INTO submissions (
          member_id, common_name_id, scientific_name_id, species_type, species_class,
          species_common_name, species_latin_name, program,
          water_type, tank_size, filter_type, temperature, ph, gh,
          reproduction_date, submitted_on, approved_on, points
        ) VALUES (?, ?, ?, 'Fish', 'Livebearers', 'Test', 'Testicus test', 'fish',
                  'Fresh', '10g', 'Sponge', '75', '7.0', '200ppm',
                  '2024-01-01', '2024-01-01', '2024-01-15', 10)
      `,
        [memberId, commonNameId, scientificNameId]
      );

      await assert.rejects(async () => await deleteSpeciesGroup(testGroupId, false), {
        message: /approved submissions/,
      });

      // Species should still exist
      const stillExists = await db.get("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.ok(stillExists, "Species should not be deleted");
    });

    test("should allow force delete of species with submissions", async () => {
      // Create member and submission
      const memberResult = await db.run(`
        INSERT INTO members (display_name, contact_email)
        VALUES ('Test Member', 'test@example.com')
      `);
      const memberId = memberResult.lastID as number;

      // Get the name IDs for split schema FKs
      const names = await getNamesForGroup(testGroupId);
      const commonNameId = names.common_names[0]?.common_name_id;
      const scientificNameId = names.scientific_names[0]?.scientific_name_id;

      await db.run(
        `
        INSERT INTO submissions (
          member_id, common_name_id, scientific_name_id, species_type, species_class,
          species_common_name, species_latin_name, program,
          water_type, tank_size, filter_type, temperature, ph, gh,
          reproduction_date, submitted_on, approved_on, points
        ) VALUES (?, ?, ?, 'Fish', 'Livebearers', 'Test', 'Testicus test', 'fish',
                  'Fresh', '10g', 'Sponge', '75', '7.0', '200ppm',
                  '2024-01-01', '2024-01-01', '2024-01-15', 10)
      `,
        [memberId, commonNameId, scientificNameId]
      );

      // Should succeed with force=true
      const changes = await deleteSpeciesGroup(testGroupId, true);
      assert.strictEqual(changes, 1);

      const result = await db.get("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(result, undefined);
    });
  });

  describe("bulkSetPoints", () => {
    let groupId1: number;
    let groupId2: number;
    let groupId3: number;

    beforeEach(async () => {
      // Create multiple test groups
      const g1 = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name, base_points)
        VALUES ('Livebearers', 'Fish', 'Bulk1', 'species1', NULL)
      `);
      groupId1 = g1.lastID as number;

      const g2 = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name, base_points)
        VALUES ('Livebearers', 'Fish', 'Bulk2', 'species2', 5)
      `);
      groupId2 = g2.lastID as number;

      const g3 = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name, base_points)
        VALUES ('Livebearers', 'Fish', 'Bulk3', 'species3', 10)
      `);
      groupId3 = g3.lastID as number;
    });

    test("should update points for multiple species", async () => {
      const changes = await bulkSetPoints([groupId1, groupId2, groupId3], 15);

      assert.strictEqual(changes, 3, "Should update all 3 species");

      const updated = await db.all(
        "SELECT base_points FROM species_name_group WHERE group_id IN (?, ?, ?)",
        [groupId1, groupId2, groupId3]
      );

      assert.ok(updated.every((s) => s.base_points === 15));
    });

    test("should update single species", async () => {
      const changes = await bulkSetPoints([groupId1], 20);

      assert.strictEqual(changes, 1);

      const updated = await db.get(
        "SELECT base_points FROM species_name_group WHERE group_id = ?",
        [groupId1]
      );
      assert.strictEqual(updated.base_points, 20);
    });

    test("should set points to null (clear points)", async () => {
      const changes = await bulkSetPoints([groupId2, groupId3], null);

      assert.strictEqual(changes, 2);

      const updated = await db.all(
        "SELECT base_points FROM species_name_group WHERE group_id IN (?, ?)",
        [groupId2, groupId3]
      );
      assert.ok(updated.every((s) => s.base_points === null));
    });

    test("should handle mix of existing and non-existent IDs", async () => {
      const changes = await bulkSetPoints([groupId1, 99999, groupId2], 30);

      assert.strictEqual(changes, 2, "Should update only existing species");

      const g1 = await db.get("SELECT base_points FROM species_name_group WHERE group_id = ?", [
        groupId1,
      ]);
      const g2 = await db.get("SELECT base_points FROM species_name_group WHERE group_id = ?", [
        groupId2,
      ]);

      assert.strictEqual(g1.base_points, 30);
      assert.strictEqual(g2.base_points, 30);
    });

    test("should return 0 if all IDs are non-existent", async () => {
      const changes = await bulkSetPoints([99998, 99999], 10);
      assert.strictEqual(changes, 0);
    });

    test("should throw error for empty group IDs array", async () => {
      await assert.rejects(async () => await bulkSetPoints([], 10), {
        message: /at least one group ID/i,
      });
    });

    test("should throw error for points below 0", async () => {
      await assert.rejects(async () => await bulkSetPoints([groupId1], -1), {
        message: /between 0 and 100/,
      });
    });

    test("should throw error for points above 100", async () => {
      await assert.rejects(async () => await bulkSetPoints([groupId1], 101), {
        message: /between 0 and 100/,
      });
    });

    test("should allow boundary values (0 and 100)", async () => {
      const changes1 = await bulkSetPoints([groupId1], 0);
      const changes2 = await bulkSetPoints([groupId2], 100);

      assert.strictEqual(changes1, 1);
      assert.strictEqual(changes2, 1);

      const g1 = await db.get("SELECT base_points FROM species_name_group WHERE group_id = ?", [
        groupId1,
      ]);
      const g2 = await db.get("SELECT base_points FROM species_name_group WHERE group_id = ?", [
        groupId2,
      ]);

      assert.strictEqual(g1.base_points, 0);
      assert.strictEqual(g2.base_points, 100);
    });

    test("should handle large batch updates efficiently", async () => {
      // Create 20 more species
      const additionalIds: number[] = [];
      for (let i = 0; i < 20; i++) {
        const result = await db.run(`
          INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
          VALUES ('Livebearers', 'Fish', 'Batch${i}', 'species${i}')
        `);
        additionalIds.push(result.lastID as number);
      }

      const allIds = [groupId1, groupId2, groupId3, ...additionalIds];
      const changes = await bulkSetPoints(allIds, 42);

      assert.strictEqual(changes, 23, "Should update all 23 species in one operation");

      // Verify a few
      const sample = await db.get("SELECT base_points FROM species_name_group WHERE group_id = ?", [
        additionalIds[10],
      ]);
      assert.strictEqual(sample.base_points, 42);
    });
  });

  describe("Integration Scenarios", () => {
    test("update then delete", async () => {
      await updateSpeciesGroup(testGroupId, { basePoints: 99 });
      const changes = await deleteSpeciesGroup(testGroupId);

      assert.strictEqual(changes, 1);
    });

    test("bulk update then individual update", async () => {
      const other = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids', 'Fish', 'Other', 'species')
      `);
      const otherId = other.lastID as number;

      await bulkSetPoints([testGroupId, otherId], 20);

      const updated1 = await db.get(
        "SELECT base_points FROM species_name_group WHERE group_id = ?",
        [testGroupId]
      );
      const updated2 = await db.get(
        "SELECT base_points FROM species_name_group WHERE group_id = ?",
        [otherId]
      );
      assert.strictEqual(updated1.base_points, 20);
      assert.strictEqual(updated2.base_points, 20);

      // Now individually update one
      await updateSpeciesGroup(testGroupId, { basePoints: 50 });

      const final1 = await db.get("SELECT base_points FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      const final2 = await db.get("SELECT base_points FROM species_name_group WHERE group_id = ?", [
        otherId,
      ]);
      assert.strictEqual(final1.base_points, 50);
      assert.strictEqual(final2.base_points, 20); // Unchanged
    });

    test("canonical name change preserves synonyms", async () => {
      await addCommonName(testGroupId, "Old Name");
      await addScientificName(testGroupId, "Testicus oldname");

      const beforeNames = await getNamesForGroup(testGroupId);
      const beforeCount = beforeNames.common_names.length + beforeNames.scientific_names.length;
      assert.strictEqual(beforeCount, 4); // 2 common + 2 scientific

      await updateSpeciesGroup(testGroupId, {
        canonicalGenus: "Renamed",
        canonicalSpeciesName: "newname",
      });

      const afterNames = await getNamesForGroup(testGroupId);
      const afterCount = afterNames.common_names.length + afterNames.scientific_names.length;
      assert.strictEqual(afterCount, 4, "Names should be preserved");

      // Verify names are still linked to the same group
      assert.ok(afterNames.common_names.every((n) => n.group_id === testGroupId));
      assert.ok(afterNames.scientific_names.every((n) => n.group_id === testGroupId));
    });
  });
});
