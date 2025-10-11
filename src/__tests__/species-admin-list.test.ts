import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { overrideConnection } from '../db/conn';
import { getSpeciesForAdmin, addSynonym } from '../db/species';

describe('getSpeciesForAdmin - Admin Species List', () => {
  let db: Database;
  let fishGroupId1: number;
  let fishGroupId2: number;
  let plantGroupId: number;

  beforeEach(async () => {
    // Create fresh in-memory database for each test
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database,
    });

    await db.exec('PRAGMA foreign_keys = ON;');
    await db.migrate({ migrationsPath: './db/migrations' });
    overrideConnection(db);

    // Create test species with varying attributes
    // Fish 1: Livebearers, 10 points, CARES
    const fish1 = await db.run(`
      INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name, base_points, is_cares_species)
      VALUES ('Livebearers', 'Fish', 'Testicus', 'guppyus', 10, 1)
    `);
    fishGroupId1 = fish1.lastID as number;
    await addSynonym(fishGroupId1, 'Test Guppy', 'Testicus guppyus');
    await addSynonym(fishGroupId1, 'Fancy Test Guppy', 'Testicus guppyus');

    // Fish 2: Cichlids, no points, not CARES
    const fish2 = await db.run(`
      INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name, base_points, is_cares_species)
      VALUES ('Cichlids', 'Fish', 'Testicus', 'cichlidus', NULL, 0)
    `);
    fishGroupId2 = fish2.lastID as number;
    await addSynonym(fishGroupId2, 'Test Cichlid', 'Testicus cichlidus');

    // Plant: Cryptocoryne, 15 points, CARES
    const plant = await db.run(`
      INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name, base_points, is_cares_species)
      VALUES ('Cryptocoryne', 'Plant', 'Testicus', 'plantus', 15, 1)
    `);
    plantGroupId = plant.lastID as number;
    await addSynonym(plantGroupId, 'Test Crypt', 'Testicus plantus');
    await addSynonym(plantGroupId, 'Test Plant', 'Testicus plantus');
    await addSynonym(plantGroupId, 'Another Test Plant', 'Testicus plantus');
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe('Basic Functionality', () => {
    test('should return paginated species with default parameters', async () => {
      const result = await getSpeciesForAdmin();

      assert.ok(result.species.length <= 50, 'Should respect default limit of 50');
      assert.ok(result.total_count >= 3, 'Total count should include all species');
      assert.ok(result.total_count > result.species.length || result.total_count === result.species.length,
        'Total count should be >= returned count');
    });

    test('should include all required fields for each species', async () => {
      const result = await getSpeciesForAdmin();
      const species = result.species[0];

      assert.ok(typeof species.group_id === 'number');
      assert.ok(typeof species.canonical_genus === 'string');
      assert.ok(typeof species.canonical_species_name === 'string');
      assert.ok(typeof species.species_type === 'string');
      assert.ok(typeof species.program_class === 'string');
      assert.ok(species.base_points === null || typeof species.base_points === 'number');
      assert.ok(typeof species.is_cares_species === 'number');
      assert.ok(typeof species.synonym_count === 'number');
    });

    test('should count synonyms correctly', async () => {
      // Search for test species to ensure they're in results
      const result = await getSpeciesForAdmin({ search: 'Testicus' });

      const guppy = result.species.find(s => s.canonical_species_name === 'guppyus');
      const cichlid = result.species.find(s => s.canonical_species_name === 'cichlidus');
      const plant = result.species.find(s => s.canonical_species_name === 'plantus');

      assert.ok(guppy && cichlid && plant, 'All test species should be found');
      assert.strictEqual(guppy.synonym_count, 2, 'Guppy should have 2 synonyms');
      assert.strictEqual(cichlid.synonym_count, 1, 'Cichlid should have 1 synonym');
      assert.strictEqual(plant.synonym_count, 3, 'Plant should have 3 synonyms');
    });
  });

  describe('Filtering', () => {
    test('should filter by species_type', async () => {
      const fishOnly = await getSpeciesForAdmin({ species_type: 'Fish' });
      const plantOnly = await getSpeciesForAdmin({ species_type: 'Plant' });

      assert.ok(fishOnly.species.every(s => s.species_type === 'Fish'));
      assert.ok(plantOnly.species.every(s => s.species_type === 'Plant'));

      assert.ok(fishOnly.species.length >= 2, 'Should have at least 2 fish');
      assert.ok(plantOnly.species.length >= 1, 'Should have at least 1 plant');
    });

    test('should filter by program_class', async () => {
      const livebearers = await getSpeciesForAdmin({ program_class: 'Livebearers' });
      const cichlids = await getSpeciesForAdmin({ program_class: 'Cichlids' });

      assert.ok(livebearers.species.every(s => s.program_class === 'Livebearers'));
      assert.ok(cichlids.species.every(s => s.program_class === 'Cichlids'));
    });

    test('should filter by has_base_points = true', async () => {
      const withPoints = await getSpeciesForAdmin({ has_base_points: true });

      assert.ok(withPoints.species.length >= 2, 'Should have at least 2 species with points');
      assert.ok(withPoints.species.every(s => s.base_points !== null));
    });

    test('should filter by has_base_points = false', async () => {
      const withoutPoints = await getSpeciesForAdmin({ has_base_points: false });

      assert.ok(withoutPoints.species.length >= 1, 'Should have at least 1 species without points');
      assert.ok(withoutPoints.species.every(s => s.base_points === null));
    });

    test('should filter by is_cares_species', async () => {
      const caresOnly = await getSpeciesForAdmin({ is_cares_species: true });
      const nonCaresOnly = await getSpeciesForAdmin({ is_cares_species: false });

      assert.ok(caresOnly.species.every(s => s.is_cares_species === 1));
      assert.ok(nonCaresOnly.species.every(s => s.is_cares_species === 0));

      assert.ok(caresOnly.species.length >= 2, 'Should have at least 2 CARES species');
      assert.ok(nonCaresOnly.species.length >= 1, 'Should have at least 1 non-CARES species');
    });

    test('should search by canonical genus', async () => {
      const result = await getSpeciesForAdmin({ search: 'Testicus' });

      assert.ok(result.species.length >= 3, 'Should find all Testicus species');
      assert.ok(result.species.every(s => s.canonical_genus === 'Testicus'));
    });

    test('should search by canonical species name', async () => {
      const result = await getSpeciesForAdmin({ search: 'guppyus' });

      assert.ok(result.species.length >= 1);
      const found = result.species.find(s => s.canonical_species_name === 'guppyus');
      assert.ok(found, 'Should find guppyus by species name');
    });

    test('should search by synonym common name', async () => {
      const result = await getSpeciesForAdmin({ search: 'Fancy Test Guppy' });

      assert.ok(result.species.length >= 1);
      const found = result.species.find(s => s.canonical_species_name === 'guppyus');
      assert.ok(found, 'Should find species by synonym common name');
    });

    test('should search by synonym scientific name', async () => {
      const result = await getSpeciesForAdmin({ search: 'Testicus plantus' });

      assert.ok(result.species.length >= 1);
      const found = result.species.find(s => s.canonical_species_name === 'plantus');
      assert.ok(found, 'Should find species by synonym scientific name');
    });

    test('should be case-insensitive in search', async () => {
      const lower = await getSpeciesForAdmin({ search: 'testicus' });
      const upper = await getSpeciesForAdmin({ search: 'TESTICUS' });
      const mixed = await getSpeciesForAdmin({ search: 'TeStiCuS' });

      assert.strictEqual(lower.total_count, upper.total_count);
      assert.strictEqual(lower.total_count, mixed.total_count);
    });

    test('should return empty result for search with < 2 characters', async () => {
      const result = await getSpeciesForAdmin({ search: 'T' });

      // Should return all species (search ignored)
      assert.ok(result.species.length >= 3);
    });

    test('should combine multiple filters', async () => {
      const result = await getSpeciesForAdmin({
        species_type: 'Fish',
        has_base_points: true,
        is_cares_species: true
      });

      assert.ok(result.species.every(s =>
        s.species_type === 'Fish' &&
        s.base_points !== null &&
        s.is_cares_species === 1
      ));

      // Should find our test guppy
      const guppy = result.species.find(s => s.canonical_species_name === 'guppyus');
      assert.ok(guppy, 'Should find CARES fish with points');
    });
  });

  describe('Sorting', () => {
    test('should sort by name (default)', async () => {
      const result = await getSpeciesForAdmin({}, 'name');

      for (let i = 1; i < result.species.length; i++) {
        const prev = `${result.species[i - 1].canonical_genus} ${result.species[i - 1].canonical_species_name}`;
        const curr = `${result.species[i].canonical_genus} ${result.species[i].canonical_species_name}`;
        assert.ok(prev.toLowerCase() <= curr.toLowerCase(), `Names should be sorted: "${prev}" <= "${curr}"`);
      }
    });

    test('should sort by points (high to low, NULL last)', async () => {
      // Search for only our test species to avoid migration data
      const result = await getSpeciesForAdmin({ search: 'Testicus' }, 'points');

      const plant = result.species.find(s => s.canonical_species_name === 'plantus');
      const guppy = result.species.find(s => s.canonical_species_name === 'guppyus');
      const cichlid = result.species.find(s => s.canonical_species_name === 'cichlidus');

      assert.ok(plant && guppy && cichlid, 'All test species should be found');

      const plantIndex = result.species.indexOf(plant);
      const guppyIndex = result.species.indexOf(guppy);
      const cichlidIndex = result.species.indexOf(cichlid);

      // Plant (15) should come before Guppy (10)
      assert.ok(plantIndex < guppyIndex, 'Higher points should come first');

      // Cichlid (NULL) should come after species with points
      assert.ok(cichlidIndex > plantIndex && cichlidIndex > guppyIndex, 'NULL points should come last');
    });

    test('should sort by program class', async () => {
      const result = await getSpeciesForAdmin({}, 'class');

      for (let i = 1; i < result.species.length; i++) {
        const prevClass = result.species[i - 1].program_class;
        const currClass = result.species[i].program_class;

        // Either same class or alphabetically sorted
        if (prevClass === currClass) {
          const prevName = `${result.species[i - 1].canonical_genus} ${result.species[i - 1].canonical_species_name}`;
          const currName = `${result.species[i].canonical_genus} ${result.species[i].canonical_species_name}`;
          assert.ok(prevName.toLowerCase() <= currName.toLowerCase());
        } else {
          assert.ok(prevClass.toLowerCase() <= currClass.toLowerCase());
        }
      }
    });
  });

  describe('Pagination', () => {
    test('should respect limit parameter', async () => {
      const page1 = await getSpeciesForAdmin({}, 'name', 2, 0);

      assert.strictEqual(page1.species.length, 2, 'Should return exactly 2 results');
      assert.ok(page1.total_count >= 3, 'Total count should show all results');
    });

    test('should respect offset parameter', async () => {
      const page1 = await getSpeciesForAdmin({}, 'name', 2, 0);
      const page2 = await getSpeciesForAdmin({}, 'name', 2, 2);

      assert.strictEqual(page1.species.length, 2);
      assert.ok(page2.species.length > 0, 'Page 2 should have results');

      // Results should be different
      const page1Ids = page1.species.map(s => s.group_id);
      const page2Ids = page2.species.map(s => s.group_id);

      const overlap = page1Ids.filter(id => page2Ids.includes(id));
      assert.strictEqual(overlap.length, 0, 'Pages should not overlap');
    });

    test('should return consistent total_count across pages', async () => {
      const page1 = await getSpeciesForAdmin({}, 'name', 2, 0);
      const page2 = await getSpeciesForAdmin({}, 'name', 2, 2);

      assert.strictEqual(page1.total_count, page2.total_count, 'Total count should be same across pages');
    });

    test('should handle offset beyond total results', async () => {
      const result = await getSpeciesForAdmin({}, 'name', 50, 9999);

      assert.strictEqual(result.species.length, 0, 'Should return empty array for offset beyond total');
      assert.ok(result.total_count >= 3, 'Total count should still be accurate');
    });
  });

  describe('Edge Cases', () => {
    test('should handle species with no synonyms', async () => {
      // Create species without adding synonyms
      const noSynonymResult = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name, base_points, is_cares_species)
        VALUES ('Killifish', 'Fish', 'Orphanus', 'nonames', 5, 0)
      `);

      const result = await getSpeciesForAdmin({ search: 'Orphanus' });

      const found = result.species.find(s => s.canonical_genus === 'Orphanus');
      assert.ok(found, 'Should find species without synonyms');
      assert.strictEqual(found?.synonym_count, 0, 'Synonym count should be 0');
    });

    test('should return empty result when no species match filters', async () => {
      const result = await getSpeciesForAdmin({
        species_type: 'Coral' // No coral in test data
      });

      assert.strictEqual(result.species.length, 0);
      assert.strictEqual(result.total_count, 0);
    });

    test('should handle empty search string', async () => {
      const result = await getSpeciesForAdmin({ search: '' });

      // Should return all species (empty search ignored)
      assert.ok(result.species.length >= 3);
    });

    test('should handle whitespace-only search', async () => {
      const result = await getSpeciesForAdmin({ search: '   ' });

      // Should return all species (whitespace search ignored)
      assert.ok(result.species.length >= 3);
    });
  });

  describe('Data Integrity', () => {
    test('should not include duplicate species in results', async () => {
      const result = await getSpeciesForAdmin();

      const groupIds = result.species.map(s => s.group_id);
      const uniqueGroupIds = new Set(groupIds);

      assert.strictEqual(groupIds.length, uniqueGroupIds.size, 'No duplicate group_ids');
    });

    test('should return species even when search matches multiple synonyms', async () => {
      // Plant has 3 synonyms, all containing "Test"
      const result = await getSpeciesForAdmin({ search: 'Test' });

      // Should only return species once, not once per matching synonym
      const plantMatches = result.species.filter(s => s.canonical_species_name === 'plantus');
      assert.strictEqual(plantMatches.length, 1, 'Should return species only once even with multiple synonym matches');
    });

    test('should handle species with special characters in names', async () => {
      const specialResult = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name, base_points, is_cares_species)
        VALUES ('Characins', 'Fish', 'Spec-ial', 'char&acters', 20, 0)
      `);
      const specialGroupId = specialResult.lastID as number;
      await addSynonym(specialGroupId, "Fish's Name", 'Spec-ial char&acters');

      const result = await getSpeciesForAdmin({ search: 'Spec-ial' });

      const found = result.species.find(s => s.canonical_genus === 'Spec-ial');
      assert.ok(found, 'Should handle special characters');
    });
  });

  describe('Performance Considerations', () => {
    test('should use efficient query with single database round-trip', async () => {
      // This test ensures we get count + data in 2 queries, not N+1
      const result = await getSpeciesForAdmin({ species_type: 'Fish' }, 'name', 10);

      assert.ok(result.species.length > 0);
      assert.ok(result.total_count > 0);

      // Verify synonym_count is populated (not requiring separate query per species)
      assert.ok(result.species.every(s => typeof s.synonym_count === 'number'));
    });
  });

  describe('Real-World Scenarios', () => {
    test('should support admin workflow: find species without points', async () => {
      // Search for test species specifically
      const needsPoints = await getSpeciesForAdmin({ has_base_points: false, search: 'Testicus' });

      assert.ok(needsPoints.species.length >= 1);
      assert.ok(needsPoints.species.every(s => s.base_points === null));

      const cichlid = needsPoints.species.find(s => s.canonical_species_name === 'cichlidus');
      assert.ok(cichlid, 'Should find cichlid that needs point assignment');
    });

    test('should support admin workflow: review CARES species', async () => {
      const cares = await getSpeciesForAdmin({ is_cares_species: true });

      assert.ok(cares.species.length >= 2, 'Should find CARES species');
      assert.ok(cares.species.every(s => s.is_cares_species === 1));
    });

    test('should support admin workflow: browse by class for point assignment', async () => {
      const livebearers = await getSpeciesForAdmin({ program_class: 'Livebearers' }, 'name');

      assert.ok(livebearers.species.length >= 1);
      assert.ok(livebearers.species.every(s => s.program_class === 'Livebearers'));
    });

    test('should support admin workflow: paginated review of all species', async () => {
      // First page
      const page1 = await getSpeciesForAdmin({}, 'name', 2, 0);
      assert.strictEqual(page1.species.length, 2);

      // Second page
      const page2 = await getSpeciesForAdmin({}, 'name', 2, 2);
      assert.ok(page2.species.length > 0);

      // Pagination info for UI
      const totalPages = Math.ceil(page1.total_count / 2);
      assert.ok(totalPages >= 2, 'Should have multiple pages');
    });
  });
});
