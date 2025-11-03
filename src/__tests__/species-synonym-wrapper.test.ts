import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import {
  getSynonymsForGroup,
  addSynonym,
  updateSynonym,
  deleteSynonym,
  getCommonNamesForGroup,
  getScientificNamesForGroup,
} from "../db/species";

/**
 * Tests for legacy synonym wrapper functions that provide backward compatibility
 * with the old species_name table model while using the new split schema.
 *
 * These functions are critical for MCP server compatibility.
 */
void describe("Species Synonym Legacy Wrappers", () => {
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
      VALUES ('Livebearers', 'Fish', 'Testicus', 'synonymus')
    `);
    testGroupId = result.lastID as number;
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  void describe("getSynonymsForGroup", () => {
    void test("should return cross-product of common × scientific names", async () => {
      // Add 2 common names and 2 scientific names
      await db.run(
        `INSERT INTO species_common_name (group_id, common_name)
         VALUES (?, 'Common 1'), (?, 'Common 2')`,
        [testGroupId, testGroupId]
      );

      await db.run(
        `INSERT INTO species_scientific_name (group_id, scientific_name)
         VALUES (?, 'Scientific 1'), (?, 'Scientific 2')`,
        [testGroupId, testGroupId]
      );

      const synonyms = await getSynonymsForGroup(testGroupId);

      // Should return 2 × 2 = 4 combinations
      assert.strictEqual(synonyms.length, 4);

      // Check all combinations exist
      const combinations = synonyms.map((s) => `${s.common_name}|${s.scientific_name}`);
      assert.ok(combinations.includes("Common 1|Scientific 1"));
      assert.ok(combinations.includes("Common 1|Scientific 2"));
      assert.ok(combinations.includes("Common 2|Scientific 1"));
      assert.ok(combinations.includes("Common 2|Scientific 2"));
    });

    void test("should return empty array when both tables are empty", async () => {
      const synonyms = await getSynonymsForGroup(testGroupId);
      assert.strictEqual(synonyms.length, 0);
    });

    void test("should pair common names with empty string when no scientific names", async () => {
      await db.run(
        `INSERT INTO species_common_name (group_id, common_name)
         VALUES (?, 'Lonely Common')`,
        [testGroupId]
      );

      const synonyms = await getSynonymsForGroup(testGroupId);

      assert.strictEqual(synonyms.length, 1);
      assert.strictEqual(synonyms[0].common_name, "Lonely Common");
      assert.strictEqual(synonyms[0].scientific_name, "");
    });

    void test("should pair scientific names with empty string when no common names", async () => {
      await db.run(
        `INSERT INTO species_scientific_name (group_id, scientific_name)
         VALUES (?, 'Lonely Scientific')`,
        [testGroupId]
      );

      const synonyms = await getSynonymsForGroup(testGroupId);

      assert.strictEqual(synonyms.length, 1);
      assert.strictEqual(synonyms[0].common_name, "");
      assert.strictEqual(synonyms[0].scientific_name, "Lonely Scientific");
    });

    void test("should include group_id in all results", async () => {
      await db.run(
        `INSERT INTO species_common_name (group_id, common_name) VALUES (?, 'Test')`,
        [testGroupId]
      );
      await db.run(
        `INSERT INTO species_scientific_name (group_id, scientific_name) VALUES (?, 'Test sci')`,
        [testGroupId]
      );

      const synonyms = await getSynonymsForGroup(testGroupId);

      assert.ok(synonyms.every((s) => s.group_id === testGroupId));
    });

    void test("should use common_name_id as name_id", async () => {
      const commonResult = await db.run(
        `INSERT INTO species_common_name (group_id, common_name) VALUES (?, 'Test')`,
        [testGroupId]
      );
      await db.run(
        `INSERT INTO species_scientific_name (group_id, scientific_name) VALUES (?, 'Test sci')`,
        [testGroupId]
      );

      const synonyms = await getSynonymsForGroup(testGroupId);

      assert.strictEqual(synonyms[0].name_id, commonResult.lastID);
    });
  });

  void describe("addSynonym", () => {
    void test("should add both common and scientific names", async () => {
      const nameId = await addSynonym(testGroupId, "New Common", "New Scientific");

      assert.ok(nameId > 0);

      // Check common name was added
      const commonNames = await getCommonNamesForGroup(testGroupId);
      assert.strictEqual(commonNames.length, 1);
      assert.strictEqual(commonNames[0].common_name, "New Common");

      // Check scientific name was added
      const scientificNames = await getScientificNamesForGroup(testGroupId);
      assert.strictEqual(scientificNames.length, 1);
      assert.strictEqual(scientificNames[0].scientific_name, "New Scientific");
    });

    void test("should return common_name_id as the identifier", async () => {
      const nameId = await addSynonym(testGroupId, "Test Common", "Test Scientific");

      const commonNames = await getCommonNamesForGroup(testGroupId);
      assert.strictEqual(nameId, commonNames[0].common_name_id);
    });

    void test("should trim whitespace from both names", async () => {
      await addSynonym(testGroupId, "  Common  ", "  Scientific  ");

      const commonNames = await getCommonNamesForGroup(testGroupId);
      const scientificNames = await getScientificNamesForGroup(testGroupId);

      assert.strictEqual(commonNames[0].common_name, "Common");
      assert.strictEqual(scientificNames[0].scientific_name, "Scientific");
    });

    void test("should throw error if common name is empty", async () => {
      await assert.rejects(
        async () => await addSynonym(testGroupId, "", "Scientific"),
        { message: /cannot be empty/ }
      );
    });

    void test("should throw error if scientific name is empty", async () => {
      await assert.rejects(
        async () => await addSynonym(testGroupId, "Common", ""),
        { message: /cannot be empty/ }
      );
    });

    void test("should throw error if species group does not exist", async () => {
      await assert.rejects(
        async () => await addSynonym(99999, "Common", "Scientific"),
        { message: /not found/ }
      );
    });

    void test("should throw error if common name already exists", async () => {
      await addSynonym(testGroupId, "Duplicate", "Scientific 1");

      await assert.rejects(
        async () => await addSynonym(testGroupId, "Duplicate", "Scientific 2"),
        { message: /already exists/ }
      );
    });

    void test("should handle scientific name already existing gracefully", async () => {
      // Add first synonym
      await addSynonym(testGroupId, "Common 1", "Shared Scientific");

      // Add second synonym with same scientific name - should succeed
      const nameId = await addSynonym(testGroupId, "Common 2", "Shared Scientific");

      assert.ok(nameId > 0);

      // Should have 2 common names but still only 1 scientific name
      const commonNames = await getCommonNamesForGroup(testGroupId);
      const scientificNames = await getScientificNamesForGroup(testGroupId);

      assert.strictEqual(commonNames.length, 2);
      assert.strictEqual(scientificNames.length, 1);
    });
  });

  void describe("updateSynonym", () => {
    let commonNameId: number;

    beforeEach(async () => {
      // Add test names
      const commonResult = await db.run(
        `INSERT INTO species_common_name (group_id, common_name) VALUES (?, 'Original Common')`,
        [testGroupId]
      );
      commonNameId = commonResult.lastID as number;
    });

    void test("should update common name when given common_name_id", async () => {
      const changes = await updateSynonym(commonNameId, {
        commonName: "Updated Common",
      });

      assert.strictEqual(changes, 1);

      const commonNames = await getCommonNamesForGroup(testGroupId);
      assert.strictEqual(commonNames[0].common_name, "Updated Common");
    });

    void test("should throw error when trying to update scientific name", async () => {
      await assert.rejects(
        async () =>
          await updateSynonym(commonNameId, {
            scientificName: "Not Supported",
          }),
        { message: /only supports updating common names/ }
      );
    });

    void test("should return 0 for non-existent common_name_id", async () => {
      const changes = await updateSynonym(99999, {
        commonName: "Test",
      });

      assert.strictEqual(changes, 0);
    });

    void test("should throw error when no updates provided", async () => {
      await assert.rejects(async () => await updateSynonym(commonNameId, {}), {
        message: /At least one field/,
      });
    });

    void test("should trim whitespace when updating", async () => {
      await updateSynonym(commonNameId, {
        commonName: "  Trimmed  ",
      });

      const commonNames = await getCommonNamesForGroup(testGroupId);
      assert.strictEqual(commonNames[0].common_name, "Trimmed");
    });
  });

  void describe("deleteSynonym", () => {
    let commonNameId: number;

    beforeEach(async () => {
      // Add multiple common names
      const common1 = await db.run(
        `INSERT INTO species_common_name (group_id, common_name) VALUES (?, 'Common 1')`,
        [testGroupId]
      );
      commonNameId = common1.lastID as number;

      await db.run(
        `INSERT INTO species_common_name (group_id, common_name) VALUES (?, 'Common 2')`,
        [testGroupId]
      );
    });

    void test("should delete common name when given common_name_id", async () => {
      const changes = await deleteSynonym(commonNameId);

      assert.strictEqual(changes, 1);

      const commonNames = await getCommonNamesForGroup(testGroupId);
      assert.strictEqual(commonNames.length, 1);
      assert.ok(!commonNames.some((n) => n.common_name_id === commonNameId));
    });

    void test("should throw error when deleting last common name without force", async () => {
      // Create a group with only one common name
      const singleCommonResult = await db.run(
        `INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
         VALUES ('Test', 'Fish', 'Single', 'common')`
      );
      const singleGroupId = singleCommonResult.lastID as number;

      const commonResult = await db.run(
        `INSERT INTO species_common_name (group_id, common_name) VALUES (?, 'Only Common')`,
        [singleGroupId]
      );
      const onlyCommonId = commonResult.lastID as number;

      await assert.rejects(async () => await deleteSynonym(onlyCommonId, false), {
        message: /Cannot delete the last common name/,
      });
    });

    void test("should allow deleting last common name with force=true", async () => {
      const singleCommonResult = await db.run(
        `INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
         VALUES ('Test', 'Fish', 'Single', 'force')`
      );
      const singleGroupId = singleCommonResult.lastID as number;

      const commonResult = await db.run(
        `INSERT INTO species_common_name (group_id, common_name) VALUES (?, 'Only Common')`,
        [singleGroupId]
      );
      const onlyCommonId = commonResult.lastID as number;

      const changes = await deleteSynonym(onlyCommonId, true);

      assert.strictEqual(changes, 1);

      const remaining = await getCommonNamesForGroup(singleGroupId);
      assert.strictEqual(remaining.length, 0);
    });

    void test("should throw error when common name ID does not exist", async () => {
      await assert.rejects(async () => await deleteSynonym(99999), {
        message: /not found/,
      });
    });

    void test("should throw error for non-existent ID even with force", async () => {
      await assert.rejects(async () => await deleteSynonym(99999, true), {
        message: /not found/,
      });
    });
  });

  void describe("Integration - Cross-function behavior", () => {
    void test("should maintain consistency between add, get, and delete", async () => {
      // Add a synonym
      const nameId = await addSynonym(testGroupId, "Test Common", "Test Scientific");

      // Get synonyms - should see the cross-product
      let synonyms = await getSynonymsForGroup(testGroupId);
      assert.strictEqual(synonyms.length, 1);
      assert.strictEqual(synonyms[0].common_name, "Test Common");
      assert.strictEqual(synonyms[0].scientific_name, "Test Scientific");

      // Add another common name - cross-product should expand
      await addSynonym(testGroupId, "Another Common", "Test Scientific");
      synonyms = await getSynonymsForGroup(testGroupId);
      assert.strictEqual(synonyms.length, 2); // 2 common × 1 scientific

      // Delete the first common name
      await deleteSynonym(nameId, true);
      synonyms = await getSynonymsForGroup(testGroupId);
      assert.strictEqual(synonyms.length, 1);
      assert.strictEqual(synonyms[0].common_name, "Another Common");
    });

    void test("should handle update-then-delete workflow", async () => {
      const nameId = await addSynonym(testGroupId, "Original", "Scientific");

      // Update
      await updateSynonym(nameId, { commonName: "Modified" });

      // Verify update
      let synonyms = await getSynonymsForGroup(testGroupId);
      assert.strictEqual(synonyms[0].common_name, "Modified");

      // Delete
      await deleteSynonym(nameId, true);

      // Verify deletion
      synonyms = await getSynonymsForGroup(testGroupId);
      assert.strictEqual(synonyms.length, 1); // Only scientific name remains with empty common
      assert.strictEqual(synonyms[0].common_name, "");
    });

    void test("should handle complex cross-product scenarios", async () => {
      // Create a species with multiple common and scientific names
      await addSynonym(testGroupId, "Common A", "Scientific 1");
      await addSynonym(testGroupId, "Common B", "Scientific 2");
      await addSynonym(testGroupId, "Common C", "Scientific 3");

      const synonyms = await getSynonymsForGroup(testGroupId);

      // Should have 3 common × 3 scientific = 9 combinations
      assert.strictEqual(synonyms.length, 9);

      // Verify a few key combinations
      const combos = synonyms.map((s) => `${s.common_name}|${s.scientific_name}`);
      assert.ok(combos.includes("Common A|Scientific 1"));
      assert.ok(combos.includes("Common B|Scientific 3"));
      assert.ok(combos.includes("Common C|Scientific 2"));
    });
  });

  void describe("MCP Server Compatibility", () => {
    void test("getSynonymsForGroup should work like old species_name query", async () => {
      // This mimics how MCP server resource handlers use the function
      await addSynonym(testGroupId, "Common Name", "Scientific Name");

      const synonyms = await getSynonymsForGroup(testGroupId);

      // Should have the fields MCP expects
      assert.ok(synonyms[0].name_id !== undefined);
      assert.ok(synonyms[0].group_id !== undefined);
      assert.ok(synonyms[0].common_name !== undefined);
      assert.ok(synonyms[0].scientific_name !== undefined);
    });

    void test("addSynonym should return usable ID for subsequent operations", async () => {
      // MCP might add a synonym and then immediately update it
      const nameId = await addSynonym(testGroupId, "Initial", "Initial Scientific");

      // Should be able to update using the returned ID
      const changes = await updateSynonym(nameId, { commonName: "Updated" });
      assert.strictEqual(changes, 1);
    });

    void test("deleteSynonym should handle IDs from getSynonymsForGroup", async () => {
      await addSynonym(testGroupId, "To Delete", "Scientific");

      const synonyms = await getSynonymsForGroup(testGroupId);
      const idToDelete = synonyms[0].name_id;

      // Should be able to delete using the ID from getSynonymsForGroup
      const changes = await deleteSynonym(idToDelete, true);
      assert.strictEqual(changes, 1);
    });
  });
});
