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
    // Create species groups
    const guppyGroupResult = await db.run(`
      INSERT INTO species_name_group (program_class, canonical_genus, canonical_species_name)
      VALUES ('Fish', 'Poecilia', 'reticulata')
    `);
    const guppyGroupId = guppyGroupResult.lastID as number;

    const tetraGroupResult = await db.run(`
      INSERT INTO species_name_group (program_class, canonical_genus, canonical_species_name)
      VALUES ('Fish', 'Nematobrycon', 'palmeri')
    `);
    const tetraGroupId = tetraGroupResult.lastID as number;

    const cryptGroupResult = await db.run(`
      INSERT INTO species_name_group (program_class, canonical_genus, canonical_species_name)
      VALUES ('Plant', 'Cryptocoryne', 'wendtii')
    `);
    const cryptGroupId = cryptGroupResult.lastID as number;

    // Insert species name synonyms
    // Guppy with multiple common names
    await db.run(`
      INSERT INTO species_name (group_id, common_name, scientific_name)
      VALUES
        (?, 'Guppy', 'Poecilia reticulata'),
        (?, 'Fancy Guppy', 'Poecilia reticulata')
    `, [guppyGroupId, guppyGroupId]);

    // Emperor Tetra
    await db.run(`
      INSERT INTO species_name (group_id, common_name, scientific_name)
      VALUES (?, 'Emperor Tetra', 'Nematobrycon palmeri')
    `, [tetraGroupId]);

    // Cryptocoryne wendtii (plant)
    await db.run(`
      INSERT INTO species_name (group_id, common_name, scientific_name)
      VALUES
        (?, 'Wendts Water Trumpet', 'Cryptocoryne wendtii'),
        (?, 'Wendt Crypt', 'Cryptocoryne wendtii')
    `, [cryptGroupId, cryptGroupId]);
  }

  test('should return empty array for queries shorter than 2 characters', async () => {
    const results = await searchSpeciesTypeahead('g');
    assert.strictEqual(results.length, 0, 'Should return empty array for single character');

    const emptyResults = await searchSpeciesTypeahead('');
    assert.strictEqual(emptyResults.length, 0, 'Should return empty array for empty string');
  });

  test('should search by common name', async () => {
    const results = await searchSpeciesTypeahead('guppy');

    assert.ok(results.length > 0, 'Should find guppy results');

    // Should find all guppy variants
    const guppyNames = results.map(r => r.common_name);
    assert.ok(guppyNames.includes('Guppy'), 'Should include standard Guppy');
    assert.ok(guppyNames.includes('Fancy Guppy'), 'Should include Fancy Guppy');

    // All results should have the same scientific name
    results.forEach(result => {
      assert.strictEqual(result.scientific_name, 'Poecilia reticulata');
    });
  });

  test('should search by scientific name', async () => {
    const results = await searchSpeciesTypeahead('Nematobrycon');

    assert.strictEqual(results.length, 1, 'Should find exactly one result');
    assert.strictEqual(results[0].common_name, 'Emperor Tetra');
    assert.strictEqual(results[0].scientific_name, 'Nematobrycon palmeri');
  });

  test('should be case-insensitive', async () => {
    const lowerResults = await searchSpeciesTypeahead('guppy');
    const upperResults = await searchSpeciesTypeahead('GUPPY');
    const mixedResults = await searchSpeciesTypeahead('GuPpY');

    assert.strictEqual(lowerResults.length, upperResults.length, 'Case should not matter');
    assert.strictEqual(lowerResults.length, mixedResults.length, 'Mixed case should work');
  });

  test('should filter by species_type (program_class)', async () => {
    const fishResults = await searchSpeciesTypeahead('crypt', { species_type: 'Fish' });
    assert.strictEqual(fishResults.length, 0, 'Should not find plants when filtering for fish');

    const plantResults = await searchSpeciesTypeahead('crypt', { species_type: 'Plant' });
    assert.ok(plantResults.length > 0, 'Should find plants when filtering for plants');

    plantResults.forEach(result => {
      assert.strictEqual(result.program_class, 'Plant');
    });
  });

  test('should respect limit parameter', async () => {
    const limit2Results = await searchSpeciesTypeahead('gu', {}, 2);
    assert.ok(limit2Results.length <= 2, 'Should respect limit of 2');

    const limit1Results = await searchSpeciesTypeahead('gu', {}, 1);
    assert.strictEqual(limit1Results.length, 1, 'Should respect limit of 1');
  });

  test('should include name_id for each result', async () => {
    const results = await searchSpeciesTypeahead('guppy');

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
    const results = await searchSpeciesTypeahead('guppy');

    assert.ok(results.length > 0, 'Should have results');

    // All guppy variants should have the same group_id
    const groupIds = [...new Set(results.map(r => r.group_id))];
    assert.strictEqual(groupIds.length, 1, 'All guppy variants should share the same group_id');
  });

  test('should include canonical names for reference', async () => {
    const results = await searchSpeciesTypeahead('emperor');

    assert.strictEqual(results.length, 1);
    const result = results[0];

    assert.strictEqual(result.canonical_genus, 'Nematobrycon');
    assert.strictEqual(result.canonical_species_name, 'palmeri');
    assert.strictEqual(result.program_class, 'Fish');
  });

  test('should order results alphabetically by common_name', async () => {
    const results = await searchSpeciesTypeahead('gu');

    if (results.length > 1) {
      for (let i = 1; i < results.length; i++) {
        const prev = results[i - 1].common_name.toLowerCase();
        const curr = results[i].common_name.toLowerCase();
        assert.ok(prev <= curr, `Results should be ordered: ${prev} <= ${curr}`);
      }
    }
  });

  test('should match partial words', async () => {
    const results = await searchSpeciesTypeahead('emp');

    assert.ok(results.length > 0, 'Should find "Emperor Tetra" with partial match "emp"');
    assert.ok(
      results.some(r => r.common_name.includes('Emperor')),
      'Should match "Emperor" with "emp"'
    );
  });

  test('should return complete SpeciesNameRecord objects', async () => {
    const results = await searchSpeciesTypeahead('guppy');

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
    // Search for something that exists in both fish and plants
    const fishResults = await searchSpeciesTypeahead('te', { species_type: 'Fish' });
    const plantResults = await searchSpeciesTypeahead('crypt', { species_type: 'Plant' });

    fishResults.forEach(result => {
      assert.strictEqual(result.program_class, 'Fish', 'Fish filter should only return fish');
    });

    plantResults.forEach(result => {
      assert.strictEqual(result.program_class, 'Plant', 'Plant filter should only return plants');
    });
  });
});
