import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import { listNames, addName, removeName, updateName } from "@/species";

void describe("Species Split Name Schema CRUD", () => {
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

  void describe("listNames: common", () => {
    void test("should return all common names for a species", async () => {
      const names = (await listNames(testGroupId)).common;

      assert.strictEqual(names.length, 2);
      assert.ok(names.every((n) => n.species_id === testGroupId));
      assert.ok(names.every((n) => n.name_id > 0));

      const nameStrings = names.map((n) => n.name).sort();
      assert.deepStrictEqual(nameStrings, ["Fancy Test Fish", "Test Fish"]);
    });

    void test("should return empty array for group with no common names", async () => {
      const emptyGroup = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids - New World', 'Fish', 'Empty', 'nonames')
      `);

      const names = (await listNames(emptyGroup.lastID as number)).common;
      assert.strictEqual(names.length, 0);
    });

    void test("should order results alphabetically", async () => {
      const names = (await listNames(testGroupId)).common;

      for (let i = 1; i < names.length; i++) {
        assert.ok(names[i - 1].name <= names[i].name);
      }
    });
  });

  void describe("listNames: scientific", () => {
    void test("should return all scientific names for a species", async () => {
      const names = (await listNames(testGroupId)).scientific;

      assert.strictEqual(names.length, 2);
      assert.ok(names.every((n) => n.species_id === testGroupId));
      assert.ok(names.every((n) => n.name_id > 0));

      const nameStrings = names.map((n) => n.name).sort();
      assert.deepStrictEqual(nameStrings, ["Testicus splitus", "Testicus splitus variant"]);
    });

    void test("should return empty array for group with no scientific names", async () => {
      const emptyGroup = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids - New World', 'Fish', 'Empty', 'noscinames')
      `);

      const names = (await listNames(emptyGroup.lastID as number)).scientific;
      assert.strictEqual(names.length, 0);
    });

    void test("should order results alphabetically", async () => {
      const names = (await listNames(testGroupId)).scientific;

      for (let i = 1; i < names.length; i++) {
        assert.ok(names[i - 1].name <= names[i].name);
      }
    });
  });

  void describe("listNames", () => {
    void test("should return both common and scientific names", async () => {
      const result = await listNames(testGroupId);

      assert.strictEqual(result.common.length, 2);
      assert.strictEqual(result.scientific.length, 2);
    });

    void test("should return empty arrays for group with no names", async () => {
      const emptyGroup = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids - New World', 'Fish', 'Empty', 'both')
      `);

      const result = await listNames(emptyGroup.lastID as number);

      assert.strictEqual(result.common.length, 0);
      assert.strictEqual(result.scientific.length, 0);
    });
  });

  void describe("addName: common", () => {
    void test("should add a common name and return ID", async () => {
      const id = await addName(testGroupId, "common", "New Common Name");

      assert.ok(id > 0);

      const names = (await listNames(testGroupId)).common;
      assert.strictEqual(names.length, 3);

      const added = names.find((n) => n.name_id === id);
      assert.strictEqual(added?.name, "New Common Name");
    });

    void test("should trim whitespace", async () => {
      const id = await addName(testGroupId, "common", "  Whitespace Name  ");

      const names = (await listNames(testGroupId)).common;
      const added = names.find((n) => n.name_id === id);
      assert.strictEqual(added?.name, "Whitespace Name");
    });

    void test("should throw error for empty name", async () => {
      await assert.rejects(async () => await addName(testGroupId, "common", ""), {
        message: /cannot be empty/,
      });

      await assert.rejects(async () => await addName(testGroupId, "common", "   "), {
        message: /cannot be empty/,
      });
    });

    void test("should throw error for non-existent group", async () => {
      await assert.rejects(async () => await addName(99999, "common", "Test"), {
        message: /not found/,
      });
    });

    void test("should throw error for duplicate common name in same group", async () => {
      await assert.rejects(async () => await addName(testGroupId, "common", "Test Fish"), {
        message: /already exists/,
      });
    });

    void test("should allow same common name in different groups", async () => {
      const otherGroup = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids - New World', 'Fish', 'Other', 'species')
      `);

      const id = await addName(otherGroup.lastID as number, "common", "Test Fish");
      assert.ok(id > 0);
    });
  });

  void describe("addName: scientific", () => {
    void test("should add a scientific name and return ID", async () => {
      const id = await addName(testGroupId, "scientific", "Testicus newscientific");

      assert.ok(id > 0);

      const names = (await listNames(testGroupId)).scientific;
      assert.strictEqual(names.length, 3);

      const added = names.find((n) => n.name_id === id);
      assert.strictEqual(added?.name, "Testicus newscientific");
    });

    void test("should trim whitespace", async () => {
      const id = await addName(testGroupId, "scientific", "  Testicus whitespace  ");

      const names = (await listNames(testGroupId)).scientific;
      const added = names.find((n) => n.name_id === id);
      assert.strictEqual(added?.name, "Testicus whitespace");
    });

    void test("should throw error for empty name", async () => {
      await assert.rejects(async () => await addName(testGroupId, "scientific", ""), {
        message: /cannot be empty/,
      });
    });

    void test("should throw error for non-existent group", async () => {
      await assert.rejects(async () => await addName(99999, "scientific", "Test"), {
        message: /not found/,
      });
    });

    void test("should throw error for duplicate scientific name in same group", async () => {
      await assert.rejects(async () => await addName(testGroupId, "scientific", "Testicus splitus"), {
        message: /already exists/,
      });
    });

    void test("should allow same scientific name in different groups", async () => {
      const otherGroup = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids - New World', 'Fish', 'Other', 'species')
      `);

      const id = await addName(otherGroup.lastID as number, "scientific", "Testicus splitus");
      assert.ok(id > 0);
    });
  });

  void describe("updateName: common", () => {
    let testCommonNameId: number;

    beforeEach(async () => {
      const names = (await listNames(testGroupId)).common;
      testCommonNameId = names[0].name_id;
    });

    void test("should update common name", async () => {
      const changes = await updateName("common", testCommonNameId, "Updated Name");

      assert.strictEqual(changes, 1);

      const names = (await listNames(testGroupId)).common;
      const updated = names.find((n) => n.name_id === testCommonNameId);
      assert.strictEqual(updated?.name, "Updated Name");
    });

    void test("should trim whitespace", async () => {
      await updateName("common", testCommonNameId, "  Trimmed  ");

      const names = (await listNames(testGroupId)).common;
      const updated = names.find((n) => n.name_id === testCommonNameId);
      assert.strictEqual(updated?.name, "Trimmed");
    });

    void test("should throw error for empty name", async () => {
      await assert.rejects(async () => await updateName("common", testCommonNameId, ""), {
        message: /cannot be empty/,
      });
    });

    void test("should return 0 for non-existent ID", async () => {
      const changes = await updateName("common", 99999, "Test");
      assert.strictEqual(changes, 0);
    });

    void test("should throw error for duplicate name in same group", async () => {
      const names = (await listNames(testGroupId)).common;
      const otherName = names.find((n) => n.name_id !== testCommonNameId);

      await assert.rejects(
        async () => await updateName("common", testCommonNameId, otherName!.name),
        { message: /already exists/ }
      );
    });
  });

  void describe("updateName: scientific", () => {
    let testScientificNameId: number;

    beforeEach(async () => {
      const names = (await listNames(testGroupId)).scientific;
      testScientificNameId = names[0].name_id;
    });

    void test("should update scientific name", async () => {
      const changes = await updateName("scientific", testScientificNameId, "Testicus updated");

      assert.strictEqual(changes, 1);

      const names = (await listNames(testGroupId)).scientific;
      const updated = names.find((n) => n.name_id === testScientificNameId);
      assert.strictEqual(updated?.name, "Testicus updated");
    });

    void test("should trim whitespace", async () => {
      await updateName("scientific", testScientificNameId, "  Testicus trimmed  ");

      const names = (await listNames(testGroupId)).scientific;
      const updated = names.find((n) => n.name_id === testScientificNameId);
      assert.strictEqual(updated?.name, "Testicus trimmed");
    });

    void test("should throw error for empty name", async () => {
      await assert.rejects(async () => await updateName("scientific", testScientificNameId, ""), {
        message: /cannot be empty/,
      });
    });

    void test("should return 0 for non-existent ID", async () => {
      const changes = await updateName("scientific", 99999, "Test");
      assert.strictEqual(changes, 0);
    });

    void test("should throw error for duplicate name in same group", async () => {
      const names = (await listNames(testGroupId)).scientific;
      const otherName = names.find((n) => n.name_id !== testScientificNameId);

      await assert.rejects(
        async () => await updateName("scientific", testScientificNameId, otherName!.name),
        { message: /already exists/ }
      );
    });
  });

  void describe("removeName: common", () => {
    void test("should delete a common name", async () => {
      const names = (await listNames(testGroupId)).common;
      const toDelete = names[0];

      const changes = await removeName("common", toDelete.name_id);

      assert.strictEqual(changes, 1);

      const remaining = (await listNames(testGroupId)).common;
      assert.strictEqual(remaining.length, 1);
      assert.ok(!remaining.some((n) => n.name_id === toDelete.name_id));
    });

    void test("should return 0 for non-existent ID", async () => {
      const changes = await removeName("common", 99999);
      assert.strictEqual(changes, 0);
    });

    void test("should allow deleting all common names", async () => {
      const names = (await listNames(testGroupId)).common;

      for (const name of names) {
        await removeName("common", name.name_id);
      }

      const remaining = (await listNames(testGroupId)).common;
      assert.strictEqual(remaining.length, 0);
    });
  });

  void describe("removeName: scientific", () => {
    void test("should delete a scientific name", async () => {
      const names = (await listNames(testGroupId)).scientific;
      const toDelete = names[0];

      const changes = await removeName("scientific", toDelete.name_id);

      assert.strictEqual(changes, 1);

      const remaining = (await listNames(testGroupId)).scientific;
      assert.strictEqual(remaining.length, 1);
      assert.ok(!remaining.some((n) => n.name_id === toDelete.name_id));
    });

    void test("should return 0 for non-existent ID", async () => {
      const changes = await removeName("scientific", 99999);
      assert.strictEqual(changes, 0);
    });

    void test("should allow deleting all scientific names", async () => {
      const names = (await listNames(testGroupId)).scientific;

      for (const name of names) {
        await removeName("scientific", name.name_id);
      }

      const remaining = (await listNames(testGroupId)).scientific;
      assert.strictEqual(remaining.length, 0);
    });
  });

  void describe("Integration - Mix of Common and Scientific Names", () => {
    void test("should allow species with many common names, one scientific", async () => {
      const group = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Livebearers', 'Fish', 'Multicus', 'commonis')
      `);
      const groupId = group.lastID as number;

      // Add 5 common names
      await addName(groupId, "common", "Guppy");
      await addName(groupId, "common", "Fancy Guppy");
      await addName(groupId, "common", "Million Fish");
      await addName(groupId, "common", "Rainbow Fish");
      await addName(groupId, "common", "Endler");

      // Add only 1 scientific name
      await addName(groupId, "scientific", "Multicus commonis");

      const result = await listNames(groupId);

      assert.strictEqual(result.common.length, 5);
      assert.strictEqual(result.scientific.length, 1);
    });

    void test("should allow species with one common name, many scientific", async () => {
      const group = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids - New World', 'Fish', 'Multicus', 'scientificus')
      `);
      const groupId = group.lastID as number;

      // Add 1 common name
      await addName(groupId, "common", "Cichlid");

      // Add 3 scientific names (synonyms/variants)
      await addName(groupId, "scientific", "Multicus scientificus");
      await addName(groupId, "scientific", "Multicus scientificus variant");
      await addName(groupId, "scientific", "Oldgenus scientificus");

      const result = await listNames(groupId);

      assert.strictEqual(result.common.length, 1);
      assert.strictEqual(result.scientific.length, 3);
    });

    void test("should handle species with no names at all", async () => {
      const group = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids - New World', 'Fish', 'Nonames', 'atall')
      `);

      const result = await listNames(group.lastID as number);

      assert.strictEqual(result.common.length, 0);
      assert.strictEqual(result.scientific.length, 0);
    });

    void test("should maintain independence of common and scientific names", async () => {
      // Delete all scientific names but keep common names
      const sciNames = (await listNames(testGroupId)).scientific;
      for (const name of sciNames) {
        await removeName("scientific", name.name_id);
      }

      const result = await listNames(testGroupId);

      assert.strictEqual(result.common.length, 2, "Common names should remain");
      assert.strictEqual(result.scientific.length, 0, "Scientific names should be gone");
    });
  });

  void describe("Unicode and Special Characters", () => {
    void test("should handle unicode in common names", async () => {
      const id = await addName(testGroupId, "common", "Pez León");

      const names = (await listNames(testGroupId)).common;
      const added = names.find((n) => n.name_id === id);
      assert.strictEqual(added?.name, "Pez León");
    });

    void test("should handle unicode in scientific names", async () => {
      const id = await addName(testGroupId, "scientific", "Testicus ñame");

      const names = (await listNames(testGroupId)).scientific;
      const added = names.find((n) => n.name_id === id);
      assert.strictEqual(added?.name, "Testicus ñame");
    });
  });
});
