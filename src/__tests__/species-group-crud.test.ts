import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import {
  createSpecies,
  updateSpecies,
  renameCanonical,
  deleteSpecies,
  setPointClass,
  addName,
  listNames,
} from "@/species";

interface SpeciesGroupRow {
  group_id: number;
  program_class: string;
  species_type: string;
  canonical_genus: string;
  canonical_species_name: string;
  base_points: number | null;
  is_cares_species: number;
  external_references: string | null;
  image_links: string | null;
}

void describe("Species catalogue: create, classify, rename, delete, Point class", () => {
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
    await addName(testGroupId, "common", "Test Fish");
    await addName(testGroupId, "scientific", "Testicus groupus");
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  void describe("createSpecies", () => {
    void test("should create a new species group and return group_id", async () => {
      const groupId = await createSpecies({
        programClass: "Characins",
        speciesType: "Fish",
        canonicalGenus: "Newgenus",
        canonicalSpeciesName: "newspecies",
        pointClass: 15,
        isCaresSpecies: true,
      });

      assert.ok(groupId > 0, "Should return positive group_id");

      const created = await db.get<SpeciesGroupRow>(
        "SELECT * FROM species_name_group WHERE group_id = ?",
        [groupId]
      );

      assert.strictEqual(created?.canonical_genus, "Newgenus");
      assert.strictEqual(created?.canonical_species_name, "newspecies");
      assert.strictEqual(created?.species_type, "Fish");
      assert.strictEqual(created?.program_class, "Characins");
      assert.strictEqual(created?.base_points, 15);
      assert.strictEqual(created?.is_cares_species, 1);
    });

    void test("should create with minimal required fields", async () => {
      const groupId = await createSpecies({
        programClass: "Killifish",
        speciesType: "Fish",
        canonicalGenus: "Minimal",
        canonicalSpeciesName: "species",
      });

      const created = await db.get<SpeciesGroupRow>("SELECT * FROM species_name_group WHERE group_id = ?", [
        groupId,
      ]);

      assert.ok(created);
      assert.strictEqual(created?.base_points, null);
      assert.strictEqual(created?.is_cares_species, 0);
    });

    void test("should trim whitespace from inputs", async () => {
      const groupId = await createSpecies({
        programClass: "  Trimmed  ",
        speciesType: "Plant",
        canonicalGenus: "  Genus  ",
        canonicalSpeciesName: "  species  ",
      });

      const created = await db.get<SpeciesGroupRow>("SELECT * FROM species_name_group WHERE group_id = ?", [
        groupId,
      ]);

      assert.strictEqual(created?.canonical_genus, "Genus");
      assert.strictEqual(created?.canonical_species_name, "species");
      assert.strictEqual(created?.program_class, "Trimmed");
    });

    void test("should throw error for empty canonical genus", async () => {
      await assert.rejects(
        async () =>
          await createSpecies({
            programClass: "Test",
            speciesType: "Fish",
            canonicalGenus: "",
            canonicalSpeciesName: "species",
          }),
        { message: /cannot be empty/ }
      );
    });

    void test("should throw error for empty canonical species name", async () => {
      await assert.rejects(
        async () =>
          await createSpecies({
            programClass: "Test",
            speciesType: "Fish",
            canonicalGenus: "Genus",
            canonicalSpeciesName: "   ",
          }),
        { message: /cannot be empty/ }
      );
    });

    void test("should throw error for empty program class", async () => {
      await assert.rejects(
        async () =>
          await createSpecies({
            programClass: "",
            speciesType: "Fish",
            canonicalGenus: "Genus",
            canonicalSpeciesName: "species",
          }),
        { message: /cannot be empty/ }
      );
    });

    void test("should throw error for invalid species type", async () => {
      await assert.rejects(
        async () =>
          await createSpecies({
            programClass: "Test",
             
            speciesType: "Invalid",
            canonicalGenus: "Genus",
            canonicalSpeciesName: "species",
          }),
        { message: /Species type must be one of Fish, Plant, Invert, Coral/ }
      );
    });

    void test("should throw error for a Point class outside the tally keys", async () => {
      for (const bad of [0, 7, 101]) {
        await assert.rejects(
          async () =>
            await createSpecies({
              programClass: "Test",
              speciesType: "Fish",
              canonicalGenus: "Genus",
              canonicalSpeciesName: "species",
              pointClass: bad,
            }),
          { message: /Point class must be one of 5, 10, 15, 20/ }
        );
      }
    });

    void test("should throw error for duplicate canonical name", async () => {
      await createSpecies({
        programClass: "Cichlids - New World",
        speciesType: "Fish",
        canonicalGenus: "Duplicate",
        canonicalSpeciesName: "test",
      });

      await assert.rejects(
        async () =>
          await createSpecies({
            programClass: "Livebearers",
            speciesType: "Fish",
            canonicalGenus: "Duplicate",
            canonicalSpeciesName: "test",
          }),
        { message: /already exists/ }
      );
    });

    void test("should allow same genus with different species", async () => {
      const id1 = await createSpecies({
        programClass: "Cichlids - New World",
        speciesType: "Fish",
        canonicalGenus: "Samegenus",
        canonicalSpeciesName: "species1",
      });

      const id2 = await createSpecies({
        programClass: "Cichlids - New World",
        speciesType: "Fish",
        canonicalGenus: "Samegenus",
        canonicalSpeciesName: "species2",
      });

      assert.ok(id1 !== id2, "Should create two different species");
    });

    void test("should allow same species name with different genus", async () => {
      const id1 = await createSpecies({
        programClass: "Cichlids - New World",
        speciesType: "Fish",
        canonicalGenus: "Genus1",
        canonicalSpeciesName: "samespecies",
      });

      const id2 = await createSpecies({
        programClass: "Cichlids - New World",
        speciesType: "Fish",
        canonicalGenus: "Genus2",
        canonicalSpeciesName: "samespecies",
      });

      assert.ok(id1 !== id2);
    });

    void test("should accept all valid species types", async () => {
      const fish = await createSpecies({
        programClass: "Cichlids - New World",
        speciesType: "Fish",
        canonicalGenus: "TypeTest",
        canonicalSpeciesName: "fish",
      });

      const plant = await createSpecies({
        programClass: "Stem Plants",
        speciesType: "Plant",
        canonicalGenus: "TypeTest",
        canonicalSpeciesName: "plant",
      });

      const invert = await createSpecies({
        programClass: "Shrimp",
        speciesType: "Invert",
        canonicalGenus: "TypeTest",
        canonicalSpeciesName: "invert",
      });

      const coral = await createSpecies({
        programClass: "Hard",
        speciesType: "Coral",
        canonicalGenus: "TypeTest",
        canonicalSpeciesName: "coral",
      });

      assert.ok(fish && plant && invert && coral, "All species types should work");
    });
  });

  void describe("renameCanonical", () => {
    void test("should rename the genus, keeping the epithet", async () => {
      await renameCanonical(testGroupId, "Newgenus", "groupus");

      const updated = await db.get<SpeciesGroupRow>("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated?.canonical_genus, "Newgenus");
      assert.strictEqual(updated?.canonical_species_name, "groupus");
    });

    void test("should rename the epithet, keeping the genus", async () => {
      await renameCanonical(testGroupId, "Testicus", "newspecies");

      const updated = await db.get<SpeciesGroupRow>("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated?.canonical_species_name, "newspecies");
      assert.strictEqual(updated?.canonical_genus, "Testicus");
    });

    void test("should trim whitespace", async () => {
      await renameCanonical(testGroupId, "  Whitespace  ", " groupus ");

      const updated = await db.get<SpeciesGroupRow>("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated?.canonical_genus, "Whitespace");
    });

    void test("should throw error for empty canonical genus", async () => {
      await assert.rejects(async () => await renameCanonical(testGroupId, "", "groupus"), {
        message: /cannot be empty/,
      });
      await assert.rejects(async () => await renameCanonical(testGroupId, "   ", "groupus"), {
        message: /cannot be empty/,
      });
    });

    void test("should throw error for empty canonical species name", async () => {
      await assert.rejects(async () => await renameCanonical(testGroupId, "Testicus", ""), {
        message: /cannot be empty/,
      });
    });

    void test("should throw error for a missing species", async () => {
      await assert.rejects(async () => await renameCanonical(99999, "Any", "name"), {
        message: /not found/,
      });
    });

    void test("should throw error for duplicate canonical name", async () => {
      await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids - New World', 'Fish', 'Existing', 'species')
      `);

      await assert.rejects(async () => await renameCanonical(testGroupId, "Existing", "species"), {
        message: /already exists/,
      });
    });
  });

  void describe("updateSpecies", () => {
    void test("should update species type", async () => {
      const changes = await updateSpecies(testGroupId, { speciesType: "Plant" });

      assert.strictEqual(changes, 1);

      const updated = await db.get<SpeciesGroupRow>("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated?.species_type, "Plant");
    });

    void test("should update program class", async () => {
      const changes = await updateSpecies(testGroupId, { programClass: "Cichlids - New World" });

      assert.strictEqual(changes, 1);

      const updated = await db.get<SpeciesGroupRow>("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated?.program_class, "Cichlids - New World");
    });

    void test("should update the Point class", async () => {
      const changes = await updateSpecies(testGroupId, { pointClass: 20 });

      assert.strictEqual(changes, 1);

      const updated = await db.get<SpeciesGroupRow>("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated?.base_points, 20);
    });

    void test("should unset the Point class", async () => {
      const changes = await updateSpecies(testGroupId, { pointClass: null });

      assert.strictEqual(changes, 1);

      const updated = await db.get<SpeciesGroupRow>("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated?.base_points, null);
    });

    void test("should update CARES status", async () => {
      const changes = await updateSpecies(testGroupId, { isCaresSpecies: false });

      assert.strictEqual(changes, 1);

      const updated = await db.get<SpeciesGroupRow>("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated?.is_cares_species, 0);
    });

    void test("should update multiple fields at once", async () => {
      const changes = await updateSpecies(testGroupId, {
        pointClass: 15,
        isCaresSpecies: false,
        programClass: "Characins",
      });

      assert.strictEqual(changes, 1);

      const updated = await db.get<SpeciesGroupRow>("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated?.base_points, 15);
      assert.strictEqual(updated?.is_cares_species, 0);
      assert.strictEqual(updated?.program_class, "Characins");
    });

    void test("should trim whitespace from the program class", async () => {
      await updateSpecies(testGroupId, { programClass: "  Trimmed  " });

      const updated = await db.get<SpeciesGroupRow>("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(updated?.program_class, "Trimmed");
    });

    void test("should return 0 for non-existent group_id", async () => {
      const changes = await updateSpecies(99999, { pointClass: 10 });

      assert.strictEqual(changes, 0);
    });

    void test("should throw error for empty program class", async () => {
      await assert.rejects(async () => await updateSpecies(testGroupId, { programClass: "  " }), {
        message: /cannot be empty/,
      });
    });

    void test("should throw error for invalid species type", async () => {
      await assert.rejects(
        async () => await updateSpecies(testGroupId, { speciesType: "InvalidType" }),
        { message: /Species type must be one of Fish, Plant, Invert, Coral/ }
      );
    });

    void test("should throw error for a Point class outside the tally keys", async () => {
      for (const bad of [-1, 0, 7, 25, 101]) {
        await assert.rejects(async () => await updateSpecies(testGroupId, { pointClass: bad }), {
          message: /Point class must be one of 5, 10, 15, 20/,
        });
      }
    });

    void test("should throw error for empty updates object", async () => {
      await assert.rejects(async () => await updateSpecies(testGroupId, {}), {
        message: /at least one field/i,
      });
    });
  });

  void describe("deleteSpecies", () => {
    void test("should delete species group and return 1", async () => {
      const changes = await deleteSpecies(testGroupId);

      assert.strictEqual(changes, 1);

      const result = await db.get<SpeciesGroupRow>("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.strictEqual(result, undefined, "Species group should be deleted");
    });

    void test("should cascade delete all synonyms (FK constraint)", async () => {
      await addName(testGroupId, "common", "Second Name");
      await addName(testGroupId, "scientific", "Testicus groupus variant");

      const beforeNames = await listNames(testGroupId);
      assert.strictEqual(beforeNames.common.length + beforeNames.scientific.length, 4);

      await deleteSpecies(testGroupId);

      const afterNames = await listNames(testGroupId);
      assert.strictEqual(
        afterNames.common.length + afterNames.scientific.length,
        0,
        "All names should be deleted"
      );
    });

    void test("should throw error for non-existent group_id", async () => {
      // The function checks if group exists before attempting delete
      await assert.rejects(async () => await deleteSpecies(99999), { message: /not found/ });
    });

    void test("should prevent deleting species with approved submissions", async () => {
      // Create member
      const memberResult = await db.run(`
        INSERT INTO members (display_name, contact_email)
        VALUES ('Test Member', 'test@example.com')
      `);
      const memberId = memberResult.lastID as number;

      // Get the common and scientific name IDs we created in beforeEach
      const names = await listNames(testGroupId);
      const commonNameId = names.common[0]?.name_id;
      const scientificNameId = names.scientific[0]?.name_id;

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

      await assert.rejects(async () => await deleteSpecies(testGroupId), {
        message: /1 of them approved\. Merge it into another species/,
      });

      // Species should still exist
      const stillExists = await db.get<SpeciesGroupRow>("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.ok(stillExists, "Species should not be deleted");
    });

    void test("should prevent deleting species with an unapproved submission, with no force", async () => {
      const memberResult = await db.run(`
        INSERT INTO members (display_name, contact_email)
        VALUES ('Test Member', 'test@example.com')
      `);
      const memberId = memberResult.lastID as number;

      const names = await listNames(testGroupId);
      const commonNameId = names.common[0]?.name_id;

      await db.run(
        `
        INSERT INTO submissions (
          member_id, common_name_id, species_type, species_class,
          species_common_name, species_latin_name, program,
          water_type, tank_size, filter_type, temperature, ph, gh,
          reproduction_date, submitted_on
        ) VALUES (?, ?, 'Fish', 'Livebearers', 'Test', 'Testicus test', 'fish',
                  'Fresh', '10g', 'Sponge', '75', '7.0', '200ppm',
                  '2024-01-01', '2024-01-01')
      `,
        [memberId, commonNameId]
      );

      await assert.rejects(async () => await deleteSpecies(testGroupId), {
        message: /Merge it into another species/,
      });

      const stillExists = await db.get<SpeciesGroupRow>("SELECT * FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      assert.ok(stillExists, "Species should not be deleted");
    });
  });

  void describe("setPointClass", () => {
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

    void test("should update points for multiple species", async () => {
      const changes = await setPointClass([groupId1, groupId2, groupId3], 15);

      assert.strictEqual(changes, 3, "Should update all 3 species");

      const updated = await db.all<{ base_points: number | null }>(
        "SELECT base_points FROM species_name_group WHERE group_id IN (?, ?, ?)",
        [groupId1, groupId2, groupId3]
      );

      assert.ok(updated.every((s: { base_points: number | null }) => s.base_points === 15));
    });

    void test("should update single species", async () => {
      const changes = await setPointClass([groupId1], 20);

      assert.strictEqual(changes, 1);

      const updated = await db.get<{ base_points: number | null }>(
        "SELECT base_points FROM species_name_group WHERE group_id = ?",
        [groupId1]
      );
      assert.strictEqual(updated?.base_points, 20);
    });

    void test("should set points to null (clear points)", async () => {
      const changes = await setPointClass([groupId2, groupId3], null);

      assert.strictEqual(changes, 2);

      const updated = await db.all<{ base_points: number | null }>(
        "SELECT base_points FROM species_name_group WHERE group_id IN (?, ?)",
        [groupId2, groupId3]
      );
      assert.ok(updated.every((s: { base_points: number | null }) => s.base_points === null));
    });

    void test("should handle mix of existing and non-existent IDs", async () => {
      const changes = await setPointClass([groupId1, 99999, groupId2], 5);

      assert.strictEqual(changes, 2, "Should update only existing species");

      const g1 = await db.get<{ base_points: number | null }>("SELECT base_points FROM species_name_group WHERE group_id = ?", [
        groupId1,
      ]);
      const g2 = await db.get<{ base_points: number | null }>("SELECT base_points FROM species_name_group WHERE group_id = ?", [
        groupId2,
      ]);

      assert.strictEqual(g1?.base_points, 5);
      assert.strictEqual(g2?.base_points, 5);
    });

    void test("should return 0 if all IDs are non-existent", async () => {
      const changes = await setPointClass([99998, 99999], 10);
      assert.strictEqual(changes, 0);
    });

    void test("should throw error for empty group IDs array", async () => {
      await assert.rejects(async () => await setPointClass([], 10), {
        message: /at least one species/i,
      });
    });

    void test("should refuse anything but a Point class or unset", async () => {
      for (const bad of [-1, 0, 7, 100, 101]) {
        await assert.rejects(async () => await setPointClass([groupId1], bad), {
          message: /Point class must be one of 5, 10, 15, 20/,
        });
      }
      const g1 = await db.get<{ base_points: number | null }>("SELECT base_points FROM species_name_group WHERE group_id = ?", [
        groupId1,
      ]);
      assert.strictEqual(g1?.base_points, null, "a refused bulk set changes nothing");
    });

    void test("should handle large batch updates efficiently", async () => {
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
      const changes = await setPointClass(allIds, 10);

      assert.strictEqual(changes, 23, "Should update all 23 species in one operation");

      // Verify a few
      const sample = await db.get<{ base_points: number | null }>("SELECT base_points FROM species_name_group WHERE group_id = ?", [
        additionalIds[10],
      ]);
      assert.strictEqual(sample?.base_points, 10);
    });
  });

  void describe("Integration Scenarios", () => {
    void test("update then delete", async () => {
      await updateSpecies(testGroupId, { pointClass: 20 });
      const changes = await deleteSpecies(testGroupId);

      assert.strictEqual(changes, 1);
    });

    void test("bulk update then individual update", async () => {
      const other = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids - New World', 'Fish', 'Other', 'species')
      `);
      const otherId = other.lastID as number;

      await setPointClass([testGroupId, otherId], 20);

      const updated1 = await db.get<{ base_points: number | null }>(
        "SELECT base_points FROM species_name_group WHERE group_id = ?",
        [testGroupId]
      );
      const updated2 = await db.get<{ base_points: number | null }>(
        "SELECT base_points FROM species_name_group WHERE group_id = ?",
        [otherId]
      );
      assert.strictEqual(updated1?.base_points, 20);
      assert.strictEqual(updated2?.base_points, 20);

      // Now individually update one
      await updateSpecies(testGroupId, { pointClass: 15 });

      const final1 = await db.get<{ base_points: number | null }>("SELECT base_points FROM species_name_group WHERE group_id = ?", [
        testGroupId,
      ]);
      const final2 = await db.get<{ base_points: number | null }>("SELECT base_points FROM species_name_group WHERE group_id = ?", [
        otherId,
      ]);
      assert.strictEqual(final1?.base_points, 15);
      assert.strictEqual(final2?.base_points, 20); // Unchanged
    });

    void test("canonical name change preserves synonyms", async () => {
      await addName(testGroupId, "common", "Old Name");
      await addName(testGroupId, "scientific", "Testicus oldname");

      const beforeNames = await listNames(testGroupId);
      const beforeCount = beforeNames.common.length + beforeNames.scientific.length;
      assert.strictEqual(beforeCount, 4); // 2 common + 2 scientific

      await renameCanonical(testGroupId, "Renamed", "newname");

      const afterNames = await listNames(testGroupId);
      assert.deepStrictEqual(
        afterNames.common.map((n) => n.name),
        ["Old Name", "Test Fish"],
        "common Names are preserved and gain nothing"
      );
      assert.deepStrictEqual(
        afterNames.scientific.map((n) => n.name),
        ["Testicus groupus", "Testicus oldname"],
        "scientific Names are preserved; the old Canonical name was already one"
      );

      // Verify names are still linked to the same group
      assert.ok(afterNames.common.every((n) => n.species_id === testGroupId));
      assert.ok(afterNames.scientific.every((n) => n.species_id === testGroupId));
    });
  });
});
