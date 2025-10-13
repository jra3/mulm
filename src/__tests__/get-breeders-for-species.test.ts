/**
 * Test suite for getBreedersForSpecies - Split schema migration
 *
 * Tests the migrated function that checks all three FK columns in submissions table:
 * species_name_id (legacy), common_name_id, and scientific_name_id.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { overrideConnection } from '../db/conn';
import {
  getBreedersForSpecies,
  createSpeciesGroup,
  addCommonName,
  addScientificName
} from '../db/species';

describe('getBreedersForSpecies - Split Schema', () => {
  let db: Database;
  let testGroupId: number;
  let member1Id: number;
  let member2Id: number;

  beforeEach(async () => {
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database,
    });

    await db.exec('PRAGMA foreign_keys = ON;');
    await db.migrate({ migrationsPath: './db/migrations' });
    overrideConnection(db);

    // Create test species group
    testGroupId = await createSpeciesGroup({
      programClass: 'Test Class',
      speciesType: 'Fish',
      canonicalGenus: 'Breederus',
      canonicalSpeciesName: 'testicus',
      basePoints: 10
    });

    // Create test members
    const member1 = await db.run(`
      INSERT INTO members (display_name, contact_email, is_admin)
      VALUES ('Test Breeder 1', 'breeder1@test.com', 0)
    `);
    member1Id = member1.lastID as number;

    const member2 = await db.run(`
      INSERT INTO members (display_name, contact_email, is_admin)
      VALUES ('Test Breeder 2', 'breeder2@test.com', 0)
    `);
    member2Id = member2.lastID as number;
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe('Common name FK', () => {
    test('should find breeders via common_name_id', async () => {
      const commonNameId = await addCommonName(testGroupId, 'Test Common Fish');

      // Create submission using common_name FK
      await db.run(`
        INSERT INTO submissions (
          member_id, common_name_id, species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES (?, ?, 'Test Common Fish', 'Breederus testicus', datetime('now'), 10, 'BAP')
      `, [member1Id, commonNameId]);

      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(breeders.length, 1);
      assert.strictEqual(breeders[0].member_id, member1Id);
      assert.strictEqual(breeders[0].breed_count, 1);
    });
  });

  describe('Scientific name FK', () => {
    test('should find breeders via scientific_name_id', async () => {
      const scientificNameId = await addScientificName(testGroupId, 'Breederus testicus');

      // Create submission using scientific_name FK
      await db.run(`
        INSERT INTO submissions (
          member_id, scientific_name_id, species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES (?, ?, 'Test Fish', 'Breederus testicus', datetime('now'), 10, 'BAP')
      `, [member1Id, scientificNameId]);

      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(breeders.length, 1);
      assert.strictEqual(breeders[0].member_id, member1Id);
      assert.strictEqual(breeders[0].breed_count, 1);
    });
  });

  describe('Mixed FK scenarios', () => {
    test('should find breeders with submissions via different FK types', async () => {
      const commonNameId = await addCommonName(testGroupId, 'Common Name');
      const scientificNameId = await addScientificName(testGroupId, 'Scientific Name');

      // Member 1: common_name submission
      await db.run(`
        INSERT INTO submissions (
          member_id, common_name_id, species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES (?, ?, 'Common Name', 'Breederus testicus', datetime('now', '-15 days'), 10, 'fish')
      `, [member1Id, commonNameId]);

      // Member 2: scientific_name submission
      await db.run(`
        INSERT INTO submissions (
          member_id, scientific_name_id, species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES (?, ?, 'Test Fish', 'Scientific Name', datetime('now'), 10, 'fish')
      `, [member2Id, scientificNameId]);

      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(breeders.length, 2, 'Should find both breeders');

      const breeder1 = breeders.find(b => b.member_id === member1Id);
      const breeder2 = breeders.find(b => b.member_id === member2Id);

      assert.ok(breeder1 && breeder2, 'Both breeders should be found');
      assert.strictEqual(breeder1.breed_count, 1, 'Member 1 should have 1 breed');
      assert.strictEqual(breeder2.breed_count, 1, 'Member 2 should have 1 breed');
    });
  });

  describe('Filtering and aggregation', () => {
    test('should only count approved submissions', async () => {
      const commonNameId = await addCommonName(testGroupId, 'Test Fish');

      // Approved submission
      await db.run(`
        INSERT INTO submissions (
          member_id, common_name_id, species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES (?, ?, 'Test Fish', 'Breederus testicus', datetime('now'), 10, 'fish')
      `, [member1Id, commonNameId]);

      // Draft submission (not approved)
      await db.run(`
        INSERT INTO submissions (
          member_id, common_name_id, species_common_name, species_latin_name,
          submitted_on, program
        ) VALUES (?, ?, 'Test Fish', 'Breederus testicus', NULL, 'fish')
      `, [member1Id, commonNameId]);

      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(breeders.length, 1);
      assert.strictEqual(breeders[0].breed_count, 1, 'Should only count approved submission');
    });

    test('should return empty array for species with no breeds', async () => {
      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(breeders.length, 0);
    });

    test('should sort by breed_count DESC', async () => {
      const commonNameId = await addCommonName(testGroupId, 'Test Fish');

      // Member 1: 1 breed
      await db.run(`
        INSERT INTO submissions (
          member_id, common_name_id, species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES (?, ?, 'Test Fish', 'Breederus testicus', datetime('now'), 10, 'fish')
      `, [member1Id, commonNameId]);

      // Member 2: 2 breeds
      await db.run(`
        INSERT INTO submissions (
          member_id, common_name_id, species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES
          (?, ?, 'Test Fish', 'Breederus testicus', datetime('now', '-10 days'), 10, 'fish'),
          (?, ?, 'Test Fish', 'Breederus testicus', datetime('now'), 10, 'fish')
      `, [member2Id, commonNameId, member2Id, commonNameId]);

      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(breeders[0].member_id, member2Id, 'Member with more breeds should be first');
      assert.strictEqual(breeders[0].breed_count, 2);
      assert.strictEqual(breeders[1].member_id, member1Id);
      assert.strictEqual(breeders[1].breed_count, 1);
    });
  });

  describe('Return value structure', () => {
    test('should include all required fields', async () => {
      const commonNameId = await addCommonName(testGroupId, 'Test Fish');

      await db.run(`
        INSERT INTO submissions (
          member_id, common_name_id, species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES (?, ?, 'Test Fish', 'Breederus testicus', '2025-01-15', 10, 'fish')
      `, [member1Id, commonNameId]);

      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(breeders.length, 1);
      const breeder = breeders[0];

      assert.ok('member_id' in breeder);
      assert.ok('member_name' in breeder);
      assert.ok('breed_count' in breeder);
      assert.ok('first_breed_date' in breeder);
      assert.ok('latest_breed_date' in breeder);
      assert.ok('submissions' in breeder);

      assert.strictEqual(typeof breeder.member_id, 'number');
      assert.strictEqual(typeof breeder.member_name, 'string');
      assert.strictEqual(typeof breeder.breed_count, 'number');
      assert.ok(Array.isArray(breeder.submissions));
    });

    test('should parse submissions array correctly', async () => {
      const commonNameId = await addCommonName(testGroupId, 'Test Fish');

      const submissionResult = await db.run(`
        INSERT INTO submissions (
          member_id, common_name_id, species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES (?, ?, 'Test Fish', 'Breederus testicus', '2025-01-15', 10, 'fish')
      `, [member1Id, commonNameId]);
      const submissionId = submissionResult.lastID as number;

      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(breeders[0].submissions.length, 1);
      const sub = breeders[0].submissions[0];

      assert.strictEqual(sub.id, submissionId);
      assert.strictEqual(sub.species_common_name, 'Test Fish');
      assert.strictEqual(sub.species_latin_name, 'Breederus testicus');
      assert.strictEqual(sub.approved_on, '2025-01-15');
      assert.strictEqual(sub.points, 10);
    });
  });

  describe('Date tracking', () => {
    test('should track first and latest breed dates correctly', async () => {
      const commonNameId = await addCommonName(testGroupId, 'Test Fish');

      await db.run(`
        INSERT INTO submissions (
          member_id, common_name_id, species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES
          (?, ?, 'Test Fish', 'Breederus testicus', '2025-01-01', 10, 'fish'),
          (?, ?, 'Test Fish', 'Breederus testicus', '2025-06-15', 10, 'fish')
      `, [member1Id, commonNameId, member1Id, commonNameId]);

      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(breeders[0].first_breed_date, '2025-01-01');
      assert.strictEqual(breeders[0].latest_breed_date, '2025-06-15');
    });
  });
});
