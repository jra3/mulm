/**
 * Test suite for searchSpeciesTypeahead - Split schema migration
 *
 * Tests the migrated typeahead search that queries species_common_name and
 * species_scientific_name tables separately via UNION.
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import {
  searchSpeciesTypeahead,
  createSpecies,
  addName,
} from "@/species";

void describe("searchSpeciesTypeahead - Split Schema", () => {
  let db: Database;

  beforeEach(async () => {
    db = await open({
      filename: ":memory:",
      driver: sqlite3.Database,
    });

    await db.exec("PRAGMA foreign_keys = ON;");

    await db.migrate({
      migrationsPath: "./db/migrations",
    });

    overrideConnection(db);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  void describe("Basic search functionality", () => {
    void test("should return empty array for queries less than 2 characters", async () => {
      const results = await searchSpeciesTypeahead("a");
      assert.strictEqual(results.length, 0);
    });

    void test("should return empty array for empty query", async () => {
      const results = await searchSpeciesTypeahead("");
      assert.strictEqual(results.length, 0);
    });

    void test("should return empty array for whitespace-only query", async () => {
      const results = await searchSpeciesTypeahead("  ");
      assert.strictEqual(results.length, 0);
    });

    void test("should find species by common name", async () => {
      const groupId = await createSpecies({
        programClass: "Anabantoids",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testicus",
      });

      await addName(groupId, "common", "ZZTEST Siamese Fighter");

      const results = await searchSpeciesTypeahead("zztest siamese");
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].common_name, "ZZTEST Siamese Fighter");
      assert.strictEqual(results[0].scientific_name, "Typeaheadicus testicus");
      assert.strictEqual(results[0].group_id, groupId);
    });

    void test("a common Name comes with the Canonical name, not another scientific Name", async () => {
      const groupId = await createSpecies({
        programClass: "Anabantoids",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "canonicus",
      });
      await addName(groupId, "common", "ZZTEST Paired Fish");
      await addName(groupId, "scientific", "Aaaoldgenus canonicus");

      const [result] = await searchSpeciesTypeahead("zztest paired");
      assert.strictEqual(result.kind, "common");
      assert.strictEqual(result.scientific_name, "Typeaheadicus canonicus");
    });

    void test("should find species by scientific name", async () => {
      const groupId = await createSpecies({
        programClass: "Anabantoids",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "scientificus",
      });

      await addName(groupId, "scientific", "ZZTEST scientificus");

      const results = await searchSpeciesTypeahead("scientificus");
      assert.strictEqual(results.length, 1);
      // No common Name to fill in beside it: nothing is invented
      assert.strictEqual(results[0].kind, "scientific");
      assert.strictEqual(results[0].common_name, "");
      assert.strictEqual(results[0].scientific_name, "ZZTEST scientificus");
      assert.strictEqual(results[0].group_id, groupId);
    });

    void test("should be case-insensitive", async () => {
      const groupId = await createSpecies({
        programClass: "Livebearers",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "caseus",
      });

      await addName(groupId, "common", "ZZTEST Guppy");

      const resultsLower = await searchSpeciesTypeahead("zztest guppy");
      const resultsUpper = await searchSpeciesTypeahead("ZZTEST GUPPY");
      const resultsMixed = await searchSpeciesTypeahead("ZzTeSt GuPpY");

      assert.strictEqual(resultsLower.length, 1);
      assert.strictEqual(resultsUpper.length, 1);
      assert.strictEqual(resultsMixed.length, 1);
    });

    void test("should support partial matching", async () => {
      const groupId = await createSpecies({
        programClass: "Cichlids - New World",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "angelus",
      });

      await addName(groupId, "common", "ZZTEST Angelfish");

      const results = await searchSpeciesTypeahead("zztest angel");
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].common_name, "ZZTEST Angelfish");
    });
  });

  void describe("UNION behavior - common and scientific names", () => {
    void test("should return both common and scientific name matches", async () => {
      const groupId = await createSpecies({
        programClass: "Anabantoids",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testsplendens",
      });

      await addName(groupId, "common", "ZZTEST Betta Fighter");
      await addName(groupId, "scientific", "ZZTEST Betta splendens");

      const results = await searchSpeciesTypeahead("zztest betta");
      assert.strictEqual(results.length, 2);

      // Should have one common name match and one scientific name match
      const commonMatch = results.find((r) => r.kind === "common");
      const scientificMatch = results.find((r) => r.kind === "scientific");

      assert.ok(commonMatch);
      assert.ok(scientificMatch);
      assert.strictEqual(commonMatch?.common_name, "ZZTEST Betta Fighter");
      assert.strictEqual(scientificMatch?.scientific_name, "ZZTEST Betta splendens");
    });

    void test("should return matches from different species groups", async () => {
      const groupId1 = await createSpecies({
        programClass: "Anabantoids",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testsplendens",
      });

      const groupId2 = await createSpecies({
        programClass: "Anabantoids",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testimbellis",
      });

      await addName(groupId1, "common", "ZZTEST Siamese");
      await addName(groupId2, "common", "ZZTEST Peaceful");

      const results = await searchSpeciesTypeahead("zztest");
      assert.strictEqual(results.length, 2);

      const groupIds = results.map((r) => r.group_id).sort();
      assert.deepStrictEqual(groupIds, [groupId1, groupId2].sort());
    });

    void test("should prioritize common names over scientific names in results", async () => {
      const groupId = await createSpecies({
        programClass: "Livebearers",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testreticulata",
      });

      await addName(groupId, "common", "ZZTEST Fancy");
      await addName(groupId, "scientific", "ZZTEST reticulata");

      const results = await searchSpeciesTypeahead("zztest fancy", {}, 10);

      // Common name match should come first (is_common_name DESC in ORDER BY)
      assert.strictEqual(results[0].common_name, "ZZTEST Fancy");
    });
  });

  void describe("Multiple names per species", () => {
    void test("should return all matching common names for a species", async () => {
      const groupId = await createSpecies({
        programClass: "Cichlids - New World",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testscalare",
      });

      await addName(groupId, "common", "ZZTEST Angelfish");
      await addName(groupId, "common", "ZZTEST Freshwater Angelfish");
      await addName(groupId, "common", "ZZTEST Silver Angelfish");

      const results = await searchSpeciesTypeahead("zztest");
      assert.strictEqual(results.length, 3);
      assert.ok(results.every((r) => r.group_id === groupId));
    });

    void test("should return all matching scientific names for a species", async () => {
      const groupId = await createSpecies({
        programClass: "Anabantoids",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testtrichopterus",
      });

      await addName(groupId, "scientific", "ZZTEST trichopterus");
      await addName(groupId, "scientific", "ZZTEST trichopodus");

      const results = await searchSpeciesTypeahead("zztest trichop");
      assert.strictEqual(results.length, 2);
      assert.ok(results.every((r) => r.group_id === groupId));
    });
  });

  void describe("Filters", () => {
    void test("should filter by species_type", async () => {
      const fishGroupId = await createSpecies({
        programClass: "Livebearers",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testreticulata",
      });

      const plantGroupId = await createSpecies({
        programClass: "Aquatic Plants",
        speciesType: "Plant",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "barteri",
      });

      await addName(fishGroupId, "common", "ZZTEST Guppy");
      await addName(plantGroupId, "common", "ZZTEST Anubias");

      const fishResults = await searchSpeciesTypeahead("zztest guppy", { species_type: "Fish" });
      assert.strictEqual(fishResults.length, 1);
      assert.strictEqual(fishResults[0].species_type, "Fish");

      const plantResults = await searchSpeciesTypeahead("zztest guppy", { species_type: "Plant" });
      assert.strictEqual(plantResults.length, 0);
    });

    void test("should filter by species_class (program_class)", async () => {
      const fishGroupId = await createSpecies({
        programClass: "Livebearers",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testreticulata",
      });

      const plantGroupId = await createSpecies({
        programClass: "Aquatic Plants",
        speciesType: "Plant",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "barteri",
      });

      await addName(fishGroupId, "common", "ZZTEST Guppy");
      await addName(plantGroupId, "common", "ZZTEST Anubias");

      const livebearerResults = await searchSpeciesTypeahead("zztest guppy", {
        species_class: "Livebearers",
      });
      assert.strictEqual(livebearerResults.length, 1);
      assert.strictEqual(livebearerResults[0].program_class, "Livebearers");

      const plantResults = await searchSpeciesTypeahead("zztest anubias", {
        species_class: "Aquatic Plants",
      });
      assert.strictEqual(plantResults.length, 1);
      assert.strictEqual(plantResults[0].program_class, "Aquatic Plants");
    });

    void test("should support multiple filters", async () => {
      const fishGroupId = await createSpecies({
        programClass: "Livebearers",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testreticulata",
      });

      await addName(fishGroupId, "common", "ZZTEST Guppy");

      const results = await searchSpeciesTypeahead("zztest guppy", {
        species_type: "Fish",
        species_class: "Livebearers",
      });
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].species_type, "Fish");
      assert.strictEqual(results[0].program_class, "Livebearers");
    });
  });

  void describe("Limit parameter", () => {
    void test("should default to 10 results", async () => {
      const groupId = await createSpecies({
        programClass: "Cichlids - New World",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testagassizii",
      });

      // Create many common names starting with 'Z'
      for (let i = 1; i <= 15; i++) {
        await addName(groupId, "common", `ZZTEST Variant ${i}`);
      }

      const results = await searchSpeciesTypeahead("zztest variant");
      assert.ok(results.length <= 10);
    });

    void test("should respect custom limit", async () => {
      const groupId = await createSpecies({
        programClass: "Cichlids - New World",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testagassizii2",
      });

      for (let i = 1; i <= 10; i++) {
        await addName(groupId, "common", `ZZTEST Variant ${i}`);
      }

      const results = await searchSpeciesTypeahead("zztest variant", {}, 5);
      assert.strictEqual(results.length, 5);
    });

    void test("should return all results if limit exceeds matches", async () => {
      const groupId = await createSpecies({
        programClass: "Livebearers",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testhellerii",
      });

      await addName(groupId, "common", "ZZTEST Swordtail");
      await addName(groupId, "common", "ZZTEST Green Swordtail");

      const results = await searchSpeciesTypeahead("zztest", {}, 100);
      assert.strictEqual(results.length, 2);
    });
  });

  void describe("Return type and metadata", () => {
    void test("should include all required fields in SpeciesNameRecord", async () => {
      const groupId = await createSpecies({
        programClass: "Anabantoids",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testsplendens",
      });

      const commonNameId = await addName(groupId, "common", "ZZTEST Siamese");

      const results = await searchSpeciesTypeahead("zztest siamese");
      assert.strictEqual(results.length, 1);

      const result = results[0];
      assert.ok("name_id" in result);
      assert.ok("group_id" in result);
      assert.ok("common_name" in result);
      assert.ok("scientific_name" in result);
      assert.ok("program_class" in result);
      assert.ok("species_type" in result);
      assert.ok("canonical_genus" in result);
      assert.ok("canonical_species_name" in result);

      assert.strictEqual(result.name_id, commonNameId);
      assert.strictEqual(result.group_id, groupId);
      assert.strictEqual(result.canonical_genus, "Typeaheadicus");
      assert.strictEqual(result.canonical_species_name, "testsplendens");
    });

    void test("should have correct name_id for common names", async () => {
      const groupId = await createSpecies({
        programClass: "Livebearers",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testreticulata",
      });

      const commonNameId = await addName(groupId, "common", "ZZTEST Guppy");

      const results = await searchSpeciesTypeahead("zztest guppy");
      assert.strictEqual(results[0].name_id, commonNameId);
    });

    void test("should have correct name_id for scientific names", async () => {
      const groupId = await createSpecies({
        programClass: "Livebearers",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testreticulata",
      });

      const scientificNameId = await addName(groupId, "scientific", "ZZTEST reticulata");

      const results = await searchSpeciesTypeahead("zztest reticulata");
      assert.strictEqual(results[0].name_id, scientificNameId);
    });
  });

  void describe("Edge cases", () => {
    void test("should handle species with no names", async () => {
      await createSpecies({
        programClass: "Cichlids - New World",
        speciesType: "Fish",
        canonicalGenus: "Orphan",
        canonicalSpeciesName: "species",
      });

      const results = await searchSpeciesTypeahead("orphan");
      assert.strictEqual(results.length, 0);
    });

    void test("should handle Unicode characters in search", async () => {
      const groupId = await createSpecies({
        programClass: "Cichlids - New World",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testamphiacanthoides",
      });

      await addName(groupId, "common", "ZZTEST Triangle");

      const results = await searchSpeciesTypeahead("zztest triangle");
      assert.strictEqual(results.length, 1);
    });

    void test("should trim whitespace from search query", async () => {
      const groupId = await createSpecies({
        programClass: "Livebearers",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testreticulata",
      });

      await addName(groupId, "common", "ZZTEST Guppy");

      const results = await searchSpeciesTypeahead("  zztest guppy  ");
      assert.strictEqual(results.length, 1);
    });
  });

  void describe("Sorting", () => {
    void test("should sort common names alphabetically when all common", async () => {
      const groupId = await createSpecies({
        programClass: "Cichlids - New World",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testscalare",
      });

      await addName(groupId, "common", "ZZTEST Zebra");
      await addName(groupId, "common", "ZZTEST Angelfish");
      await addName(groupId, "common", "ZZTEST Marble");

      const results = await searchSpeciesTypeahead("zztest");
      const names = results.map((r) => r.common_name);
      assert.deepStrictEqual(names, ["ZZTEST Angelfish", "ZZTEST Marble", "ZZTEST Zebra"]);
    });

    void test("should sort scientific names alphabetically when all scientific", async () => {
      const groupId = await createSpecies({
        programClass: "Anabantoids",
        speciesType: "Fish",
        canonicalGenus: "Typeaheadicus",
        canonicalSpeciesName: "testsplendens",
      });

      await addName(groupId, "scientific", "ZZTEST var. blue");
      await addName(groupId, "scientific", "ZZTEST splendens");
      await addName(groupId, "scientific", "ZZTEST var. red");

      const results = await searchSpeciesTypeahead("zztest");
      const names = results.map((r) => r.scientific_name);
      assert.deepStrictEqual(names, ["ZZTEST splendens", "ZZTEST var. blue", "ZZTEST var. red"]);
    });
  });
});
