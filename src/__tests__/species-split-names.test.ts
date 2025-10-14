import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import {
  getCommonNamesForGroup,
  getScientificNamesForGroup,
  getNamesForGroup,
  addCommonName,
  addScientificName,
  updateCommonName,
  updateScientificName,
  deleteCommonName,
  deleteScientificName,
} from "../db/species";

describe("Species Split Name Schema CRUD", () => {
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
      INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
      VALUES ('Livebearers', 'Fish', 'Testicus', 'splitus')
    `);
    testGroupId = result.lastID as number;

    // Add initial names
    await db.run(
      `
      INSERT INTO species_common_name (group_id, common_name)
      VALUES (?, 'Test Fish'), (?, 'Fancy Test Fish')
    `,
      [testGroupId, testGroupId]
    );

    await db.run(
      `
      INSERT INTO species_scientific_name (group_id, scientific_name)
      VALUES (?, 'Testicus splitus'), (?, 'Testicus splitus variant')
    `,
      [testGroupId, testGroupId]
    );
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("getCommonNamesForGroup", () => {
    test("should return all common names for a species", async () => {
      const names = await getCommonNamesForGroup(testGroupId);

      assert.strictEqual(names.length, 2);
      assert.ok(names.every((n) => n.group_id === testGroupId));
      assert.ok(names.every((n) => n.common_name_id > 0));

      const nameStrings = names.map((n) => n.common_name).sort();
      assert.deepStrictEqual(nameStrings, ["Fancy Test Fish", "Test Fish"]);
    });

    test("should return empty array for group with no common names", async () => {
      const emptyGroup = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids', 'Fish', 'Empty', 'nonames')
      `);

      const names = await getCommonNamesForGroup(emptyGroup.lastID as number);
      assert.strictEqual(names.length, 0);
    });

    test("should order results alphabetically", async () => {
      const names = await getCommonNamesForGroup(testGroupId);

      for (let i = 1; i < names.length; i++) {
        assert.ok(names[i - 1].common_name <= names[i].common_name);
      }
    });
  });

  describe("getScientificNamesForGroup", () => {
    test("should return all scientific names for a species", async () => {
      const names = await getScientificNamesForGroup(testGroupId);

      assert.strictEqual(names.length, 2);
      assert.ok(names.every((n) => n.group_id === testGroupId));
      assert.ok(names.every((n) => n.scientific_name_id > 0));

      const nameStrings = names.map((n) => n.scientific_name).sort();
      assert.deepStrictEqual(nameStrings, ["Testicus splitus", "Testicus splitus variant"]);
    });

    test("should return empty array for group with no scientific names", async () => {
      const emptyGroup = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids', 'Fish', 'Empty', 'noscinames')
      `);

      const names = await getScientificNamesForGroup(emptyGroup.lastID as number);
      assert.strictEqual(names.length, 0);
    });

    test("should order results alphabetically", async () => {
      const names = await getScientificNamesForGroup(testGroupId);

      for (let i = 1; i < names.length; i++) {
        assert.ok(names[i - 1].scientific_name <= names[i].scientific_name);
      }
    });
  });

  describe("getNamesForGroup", () => {
    test("should return both common and scientific names", async () => {
      const result = await getNamesForGroup(testGroupId);

      assert.strictEqual(result.common_names.length, 2);
      assert.strictEqual(result.scientific_names.length, 2);
    });

    test("should return empty arrays for group with no names", async () => {
      const emptyGroup = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids', 'Fish', 'Empty', 'both')
      `);

      const result = await getNamesForGroup(emptyGroup.lastID as number);

      assert.strictEqual(result.common_names.length, 0);
      assert.strictEqual(result.scientific_names.length, 0);
    });
  });

  describe("addCommonName", () => {
    test("should add a common name and return ID", async () => {
      const id = await addCommonName(testGroupId, "New Common Name");

      assert.ok(id > 0);

      const names = await getCommonNamesForGroup(testGroupId);
      assert.strictEqual(names.length, 3);

      const added = names.find((n) => n.common_name_id === id);
      assert.strictEqual(added?.common_name, "New Common Name");
    });

    test("should trim whitespace", async () => {
      const id = await addCommonName(testGroupId, "  Whitespace Name  ");

      const names = await getCommonNamesForGroup(testGroupId);
      const added = names.find((n) => n.common_name_id === id);
      assert.strictEqual(added?.common_name, "Whitespace Name");
    });

    test("should throw error for empty name", async () => {
      await assert.rejects(async () => await addCommonName(testGroupId, ""), {
        message: /cannot be empty/,
      });

      await assert.rejects(async () => await addCommonName(testGroupId, "   "), {
        message: /cannot be empty/,
      });
    });

    test("should throw error for non-existent group", async () => {
      await assert.rejects(async () => await addCommonName(99999, "Test"), {
        message: /not found/,
      });
    });

    test("should throw error for duplicate common name in same group", async () => {
      await assert.rejects(async () => await addCommonName(testGroupId, "Test Fish"), {
        message: /already exists/,
      });
    });

    test("should allow same common name in different groups", async () => {
      const otherGroup = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids', 'Fish', 'Other', 'species')
      `);

      const id = await addCommonName(otherGroup.lastID as number, "Test Fish");
      assert.ok(id > 0);
    });
  });

  describe("addScientificName", () => {
    test("should add a scientific name and return ID", async () => {
      const id = await addScientificName(testGroupId, "Testicus newscientific");

      assert.ok(id > 0);

      const names = await getScientificNamesForGroup(testGroupId);
      assert.strictEqual(names.length, 3);

      const added = names.find((n) => n.scientific_name_id === id);
      assert.strictEqual(added?.scientific_name, "Testicus newscientific");
    });

    test("should trim whitespace", async () => {
      const id = await addScientificName(testGroupId, "  Testicus whitespace  ");

      const names = await getScientificNamesForGroup(testGroupId);
      const added = names.find((n) => n.scientific_name_id === id);
      assert.strictEqual(added?.scientific_name, "Testicus whitespace");
    });

    test("should throw error for empty name", async () => {
      await assert.rejects(async () => await addScientificName(testGroupId, ""), {
        message: /cannot be empty/,
      });
    });

    test("should throw error for non-existent group", async () => {
      await assert.rejects(async () => await addScientificName(99999, "Test"), {
        message: /not found/,
      });
    });

    test("should throw error for duplicate scientific name in same group", async () => {
      await assert.rejects(async () => await addScientificName(testGroupId, "Testicus splitus"), {
        message: /already exists/,
      });
    });

    test("should allow same scientific name in different groups", async () => {
      const otherGroup = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids', 'Fish', 'Other', 'species')
      `);

      const id = await addScientificName(otherGroup.lastID as number, "Testicus splitus");
      assert.ok(id > 0);
    });
  });

  describe("updateCommonName", () => {
    let testCommonNameId: number;

    beforeEach(async () => {
      const names = await getCommonNamesForGroup(testGroupId);
      testCommonNameId = names[0].common_name_id;
    });

    test("should update common name", async () => {
      const changes = await updateCommonName(testCommonNameId, "Updated Name");

      assert.strictEqual(changes, 1);

      const names = await getCommonNamesForGroup(testGroupId);
      const updated = names.find((n) => n.common_name_id === testCommonNameId);
      assert.strictEqual(updated?.common_name, "Updated Name");
    });

    test("should trim whitespace", async () => {
      await updateCommonName(testCommonNameId, "  Trimmed  ");

      const names = await getCommonNamesForGroup(testGroupId);
      const updated = names.find((n) => n.common_name_id === testCommonNameId);
      assert.strictEqual(updated?.common_name, "Trimmed");
    });

    test("should throw error for empty name", async () => {
      await assert.rejects(async () => await updateCommonName(testCommonNameId, ""), {
        message: /cannot be empty/,
      });
    });

    test("should return 0 for non-existent ID", async () => {
      const changes = await updateCommonName(99999, "Test");
      assert.strictEqual(changes, 0);
    });

    test("should throw error for duplicate name in same group", async () => {
      const names = await getCommonNamesForGroup(testGroupId);
      const otherName = names.find((n) => n.common_name_id !== testCommonNameId);

      await assert.rejects(
        async () => await updateCommonName(testCommonNameId, otherName!.common_name),
        { message: /already exists/ }
      );
    });
  });

  describe("updateScientificName", () => {
    let testScientificNameId: number;

    beforeEach(async () => {
      const names = await getScientificNamesForGroup(testGroupId);
      testScientificNameId = names[0].scientific_name_id;
    });

    test("should update scientific name", async () => {
      const changes = await updateScientificName(testScientificNameId, "Testicus updated");

      assert.strictEqual(changes, 1);

      const names = await getScientificNamesForGroup(testGroupId);
      const updated = names.find((n) => n.scientific_name_id === testScientificNameId);
      assert.strictEqual(updated?.scientific_name, "Testicus updated");
    });

    test("should trim whitespace", async () => {
      await updateScientificName(testScientificNameId, "  Testicus trimmed  ");

      const names = await getScientificNamesForGroup(testGroupId);
      const updated = names.find((n) => n.scientific_name_id === testScientificNameId);
      assert.strictEqual(updated?.scientific_name, "Testicus trimmed");
    });

    test("should throw error for empty name", async () => {
      await assert.rejects(async () => await updateScientificName(testScientificNameId, ""), {
        message: /cannot be empty/,
      });
    });

    test("should return 0 for non-existent ID", async () => {
      const changes = await updateScientificName(99999, "Test");
      assert.strictEqual(changes, 0);
    });

    test("should throw error for duplicate name in same group", async () => {
      const names = await getScientificNamesForGroup(testGroupId);
      const otherName = names.find((n) => n.scientific_name_id !== testScientificNameId);

      await assert.rejects(
        async () => await updateScientificName(testScientificNameId, otherName!.scientific_name),
        { message: /already exists/ }
      );
    });
  });

  describe("deleteCommonName", () => {
    test("should delete a common name", async () => {
      const names = await getCommonNamesForGroup(testGroupId);
      const toDelete = names[0];

      const changes = await deleteCommonName(toDelete.common_name_id);

      assert.strictEqual(changes, 1);

      const remaining = await getCommonNamesForGroup(testGroupId);
      assert.strictEqual(remaining.length, 1);
      assert.ok(!remaining.some((n) => n.common_name_id === toDelete.common_name_id));
    });

    test("should return 0 for non-existent ID", async () => {
      const changes = await deleteCommonName(99999);
      assert.strictEqual(changes, 0);
    });

    test("should allow deleting all common names", async () => {
      const names = await getCommonNamesForGroup(testGroupId);

      for (const name of names) {
        await deleteCommonName(name.common_name_id);
      }

      const remaining = await getCommonNamesForGroup(testGroupId);
      assert.strictEqual(remaining.length, 0);
    });
  });

  describe("deleteScientificName", () => {
    test("should delete a scientific name", async () => {
      const names = await getScientificNamesForGroup(testGroupId);
      const toDelete = names[0];

      const changes = await deleteScientificName(toDelete.scientific_name_id);

      assert.strictEqual(changes, 1);

      const remaining = await getScientificNamesForGroup(testGroupId);
      assert.strictEqual(remaining.length, 1);
      assert.ok(!remaining.some((n) => n.scientific_name_id === toDelete.scientific_name_id));
    });

    test("should return 0 for non-existent ID", async () => {
      const changes = await deleteScientificName(99999);
      assert.strictEqual(changes, 0);
    });

    test("should allow deleting all scientific names", async () => {
      const names = await getScientificNamesForGroup(testGroupId);

      for (const name of names) {
        await deleteScientificName(name.scientific_name_id);
      }

      const remaining = await getScientificNamesForGroup(testGroupId);
      assert.strictEqual(remaining.length, 0);
    });
  });

  describe("Integration - Mix of Common and Scientific Names", () => {
    test("should allow species with many common names, one scientific", async () => {
      const group = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Livebearers', 'Fish', 'Multicus', 'commonis')
      `);
      const groupId = group.lastID as number;

      // Add 5 common names
      await addCommonName(groupId, "Guppy");
      await addCommonName(groupId, "Fancy Guppy");
      await addCommonName(groupId, "Million Fish");
      await addCommonName(groupId, "Rainbow Fish");
      await addCommonName(groupId, "Endler");

      // Add only 1 scientific name
      await addScientificName(groupId, "Multicus commonis");

      const result = await getNamesForGroup(groupId);

      assert.strictEqual(result.common_names.length, 5);
      assert.strictEqual(result.scientific_names.length, 1);
    });

    test("should allow species with one common name, many scientific", async () => {
      const group = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids', 'Fish', 'Multicus', 'scientificus')
      `);
      const groupId = group.lastID as number;

      // Add 1 common name
      await addCommonName(groupId, "Cichlid");

      // Add 3 scientific names (synonyms/variants)
      await addScientificName(groupId, "Multicus scientificus");
      await addScientificName(groupId, "Multicus scientificus variant");
      await addScientificName(groupId, "Oldgenus scientificus");

      const result = await getNamesForGroup(groupId);

      assert.strictEqual(result.common_names.length, 1);
      assert.strictEqual(result.scientific_names.length, 3);
    });

    test("should handle species with no names at all", async () => {
      const group = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids', 'Fish', 'Nonames', 'atall')
      `);

      const result = await getNamesForGroup(group.lastID as number);

      assert.strictEqual(result.common_names.length, 0);
      assert.strictEqual(result.scientific_names.length, 0);
    });

    test("should maintain independence of common and scientific names", async () => {
      // Delete all scientific names but keep common names
      const sciNames = await getScientificNamesForGroup(testGroupId);
      for (const name of sciNames) {
        await deleteScientificName(name.scientific_name_id);
      }

      const result = await getNamesForGroup(testGroupId);

      assert.strictEqual(result.common_names.length, 2, "Common names should remain");
      assert.strictEqual(result.scientific_names.length, 0, "Scientific names should be gone");
    });
  });

  describe("Unicode and Special Characters", () => {
    test("should handle unicode in common names", async () => {
      const id = await addCommonName(testGroupId, "Pez León");

      const names = await getCommonNamesForGroup(testGroupId);
      const added = names.find((n) => n.common_name_id === id);
      assert.strictEqual(added?.common_name, "Pez León");
    });

    test("should handle unicode in scientific names", async () => {
      const id = await addScientificName(testGroupId, "Testicus ñame");

      const names = await getScientificNamesForGroup(testGroupId);
      const added = names.find((n) => n.scientific_name_id === id);
      assert.strictEqual(added?.scientific_name, "Testicus ñame");
    });
  });
});
