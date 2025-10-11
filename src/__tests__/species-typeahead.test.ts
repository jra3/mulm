import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { overrideConnection } from '../db/conn';
import { searchSpeciesTypeahead, SpeciesNameRecord } from '../db/species';

describe('Species Typeahead Search Tests', () => {
  let db: Database;

  beforeEach(async () => {
    // Create fresh in-memory database for each test
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database,
    });

    // Enable foreign key constraints
    await db.exec('PRAGMA foreign_keys = ON;');

    // Run migrations
    await db.migrate({
      migrationsPath: './db/migrations',
    });

    // Override the global connection
    overrideConnection(db);

    // Insert test species data
    await setupTestSpecies();
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  async function setupTestSpecies() {
    // Use unique test species that won't conflict with migration data
    // Using "Testicus" genus to ensure uniqueness
    const testFishGroupResult = await db.run(`
      INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
      VALUES ('Livebearers', 'Fish', 'Testicus', 'fishus')
    `);
    const testFishGroupId = testFishGroupResult.lastID as number;

    const testFish2GroupResult = await db.run(`
      INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
      VALUES ('Characins', 'Fish', 'Testicus', 'characterus')
    `);
    const testFish2GroupId = testFish2GroupResult.lastID as number;

    const testPlantGroupResult = await db.run(`
      INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
      VALUES ('Cryptocoryne', 'Plant', 'Testicus', 'plantus')
    `);
    const testPlantGroupId = testPlantGroupResult.lastID as number;

    // Insert species name synonyms
    // Test fish with multiple common names
    await db.run(`
      INSERT INTO species_name (group_id, common_name, scientific_name)
      VALUES
        (?, 'Test Guppy', 'Testicus fishus'),
        (?, 'Fancy Test Guppy', 'Testicus fishus')
    `, [testFishGroupId, testFishGroupId]);

    // Test Emperor
    await db.run(`
      INSERT INTO species_name (group_id, common_name, scientific_name)
      VALUES (?, 'Test Emperor Tetra', 'Testicus characterus')
    `, [testFish2GroupId]);

    // Test Crypt (plant)
    await db.run(`
      INSERT INTO species_name (group_id, common_name, scientific_name)
      VALUES
        (?, 'Test Crypt', 'Testicus plantus'),
        (?, 'Test Wendt Crypt', 'Testicus plantus')
    `, [testPlantGroupId, testPlantGroupId]);
  }

  test('should return empty array for queries shorter than 2 characters', async () => {
    const results = await searchSpeciesTypeahead('g');
    assert.strictEqual(results.length, 0, 'Should return empty array for single character');

    const emptyResults = await searchSpeciesTypeahead('');
    assert.strictEqual(emptyResults.length, 0, 'Should return empty array for empty string');
  });

  test('should search by common name', async () => {
    const results = await searchSpeciesTypeahead('Test Guppy');

    assert.ok(results.length > 0, 'Should find test guppy results');

    // Should find all test guppy variants
    const guppyNames = results.map(r => r.common_name);
    assert.ok(guppyNames.includes('Test Guppy'), 'Should include Test Guppy');
    assert.ok(guppyNames.includes('Fancy Test Guppy'), 'Should include Fancy Test Guppy');

    // All results should have the same scientific name
    results.forEach(result => {
      assert.strictEqual(result.scientific_name, 'Testicus fishus');
    });
  });

  test('should search by scientific name', async () => {
    const results = await searchSpeciesTypeahead('Testicus characterus');

    assert.strictEqual(results.length, 1, 'Should find exactly one result');
    assert.strictEqual(results[0].common_name, 'Test Emperor Tetra');
    assert.strictEqual(results[0].scientific_name, 'Testicus characterus');
  });

  test('should be case-insensitive', async () => {
    const lowerResults = await searchSpeciesTypeahead('test guppy');
    const upperResults = await searchSpeciesTypeahead('TEST GUPPY');
    const mixedResults = await searchSpeciesTypeahead('TeSt GuPpY');

    assert.strictEqual(lowerResults.length, upperResults.length, 'Case should not matter');
    assert.strictEqual(lowerResults.length, mixedResults.length, 'Mixed case should work');
  });

  test('should filter by species_type (program_class)', async () => {
    const fishResults = await searchSpeciesTypeahead('Test Crypt', { species_type: 'Fish' });
    assert.strictEqual(fishResults.length, 0, 'Should not find plants when filtering for fish');

    const plantResults = await searchSpeciesTypeahead('Test Crypt', { species_type: 'Plant' });
    assert.ok(plantResults.length > 0, 'Should find plants when filtering for plants');

    plantResults.forEach(result => {
      assert.strictEqual(result.program_class, 'Cryptocoryne');
    });
  });

  test('should respect limit parameter', async () => {
    const limit2Results = await searchSpeciesTypeahead('Test', {}, 2);
    assert.ok(limit2Results.length <= 2, 'Should respect limit of 2');

    const limit1Results = await searchSpeciesTypeahead('Test', {}, 1);
    assert.strictEqual(limit1Results.length, 1, 'Should respect limit of 1');
  });

  test('should include name_id for each result', async () => {
    const results = await searchSpeciesTypeahead('Test Guppy');

    assert.ok(results.length > 0, 'Should have results');

    results.forEach(result => {
      assert.ok(result.name_id, 'Each result should have a name_id');
      assert.strictEqual(typeof result.name_id, 'number', 'name_id should be a number');
      assert.ok(result.name_id > 0, 'name_id should be positive');
    });

    // Each synonym should have a unique name_id
    const nameIds = results.map(r => r.name_id);
    const uniqueNameIds = new Set(nameIds);
    assert.strictEqual(nameIds.length, uniqueNameIds.size, 'Each synonym should have unique name_id');
  });

  test('should include group_id for grouping synonyms', async () => {
    const results = await searchSpeciesTypeahead('Test Guppy');

    assert.ok(results.length > 0, 'Should have results');

    // All test guppy variants should have the same group_id
    const groupIds = [...new Set(results.map(r => r.group_id))];
    assert.strictEqual(groupIds.length, 1, 'All test guppy variants should share the same group_id');
  });

  test('should include canonical names for reference', async () => {
    const results = await searchSpeciesTypeahead('Test Emperor');

    assert.strictEqual(results.length, 1);
    const result = results[0];

    assert.strictEqual(result.canonical_genus, 'Testicus');
    assert.strictEqual(result.canonical_species_name, 'characterus');
    assert.strictEqual(result.program_class, 'Characins');
  });

  test('should order results alphabetically by common_name', async () => {
    const results = await searchSpeciesTypeahead('Test');

    if (results.length > 1) {
      for (let i = 1; i < results.length; i++) {
        const prev = results[i - 1].common_name.toLowerCase();
        const curr = results[i].common_name.toLowerCase();
        assert.ok(prev <= curr, `Results should be ordered: ${prev} <= ${curr}`);
      }
    }
  });

  test('should match partial words', async () => {
    const results = await searchSpeciesTypeahead('Test Emp');

    assert.ok(results.length > 0, 'Should find "Test Emperor Tetra" with partial match');
    assert.ok(
      results.some(r => r.common_name.includes('Emperor')),
      'Should match "Emperor" in name'
    );
  });

  test('should return complete SpeciesNameRecord objects', async () => {
    const results = await searchSpeciesTypeahead('Test Guppy');

    assert.ok(results.length > 0);

    const result = results[0];

    // Verify all required fields are present
    assert.ok(typeof result.name_id === 'number', 'Should have name_id');
    assert.ok(typeof result.group_id === 'number', 'Should have group_id');
    assert.ok(typeof result.common_name === 'string', 'Should have common_name');
    assert.ok(typeof result.scientific_name === 'string', 'Should have scientific_name');
    assert.ok(typeof result.program_class === 'string', 'Should have program_class');
    assert.ok(typeof result.canonical_genus === 'string', 'Should have canonical_genus');
    assert.ok(typeof result.canonical_species_name === 'string', 'Should have canonical_species_name');
  });

  test('should not match across different species types when filtered', async () => {
    // Search for test species with different types
    const fishResults = await searchSpeciesTypeahead('Test', { species_type: 'Fish' });
    const plantResults = await searchSpeciesTypeahead('Test Crypt', { species_type: 'Plant' });

    fishResults.forEach(result => {
      assert.strictEqual(result.species_type, 'Fish', 'Fish filter should only return fish');
    });

    plantResults.forEach(result => {
      assert.strictEqual(result.species_type, 'Plant', 'Plant filter should only return plants');
    });
  });
});
