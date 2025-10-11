import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { overrideConnection } from '../db/conn';
import {
  getSynonymsForGroup,
  addSynonym,
  updateSynonym,
  deleteSynonym
} from '../db/species';

describe('Species Synonym CRUD Operations', () => {
  let db: Database;
  let testGroupId: number;

  beforeEach(async () => {
    // Create fresh in-memory database for each test
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database,
    });

    await db.exec('PRAGMA foreign_keys = ON;');
    await db.migrate({ migrationsPath: './db/migrations' });
    overrideConnection(db);

    // Create test species group
    const result = await db.run(`
      INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
      VALUES ('Livebearers', 'Fish', 'Testicus', 'synonymus')
    `);
    testGroupId = result.lastID as number;

    // Add initial synonyms
    await db.run(`
      INSERT INTO species_name (group_id, common_name, scientific_name)
      VALUES
        (?, 'Test Fish', 'Testicus synonymus'),
        (?, 'Fancy Test Fish', 'Testicus synonymus')
    `, [testGroupId, testGroupId]);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe('getSynonymsForGroup', () => {
    test('should return all synonyms for a species group', async () => {
      const synonyms = await getSynonymsForGroup(testGroupId);

      assert.strictEqual(synonyms.length, 2);
      assert.ok(synonyms.every(s => s.group_id === testGroupId));
      assert.ok(synonyms.every(s => s.name_id > 0));

      const names = synonyms.map(s => s.common_name).sort();
      assert.deepStrictEqual(names, ['Fancy Test Fish', 'Test Fish']);
    });

    test('should return empty array for group with no synonyms', async () => {
      const emptyGroupResult = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids', 'Fish', 'Empticus', 'nonames')
      `);
      const emptyGroupId = emptyGroupResult.lastID as number;

      const synonyms = await getSynonymsForGroup(emptyGroupId);
      assert.strictEqual(synonyms.length, 0);
    });

    test('should order results by common_name then scientific_name', async () => {
      const synonyms = await getSynonymsForGroup(testGroupId);

      for (let i = 1; i < synonyms.length; i++) {
        const prev = synonyms[i - 1].common_name.toLowerCase();
        const curr = synonyms[i].common_name.toLowerCase();
        assert.ok(prev <= curr, `Synonyms should be ordered: "${prev}" <= "${curr}"`);
      }
    });
  });

  describe('addSynonym', () => {
    test('should add a new synonym and return name_id', async () => {
      const nameId = await addSynonym(testGroupId, 'New Test Name', 'Testicus synonymus variant');

      assert.ok(nameId > 0, 'Should return positive name_id');

      const synonyms = await getSynonymsForGroup(testGroupId);
      assert.strictEqual(synonyms.length, 3, 'Should have 3 synonyms now');

      const newSynonym = synonyms.find(s => s.name_id === nameId);
      assert.ok(newSynonym, 'New synonym should be findable');
      assert.strictEqual(newSynonym?.common_name, 'New Test Name');
      assert.strictEqual(newSynonym?.scientific_name, 'Testicus synonymus variant');
    });

    test('should trim whitespace from inputs', async () => {
      const nameId = await addSynonym(testGroupId, '  Whitespace Fish  ', '  Testicus whitespace  ');

      const synonyms = await getSynonymsForGroup(testGroupId);
      const newSynonym = synonyms.find(s => s.name_id === nameId);

      assert.strictEqual(newSynonym?.common_name, 'Whitespace Fish');
      assert.strictEqual(newSynonym?.scientific_name, 'Testicus whitespace');
    });

    test('should throw error for empty common name', async () => {
      await assert.rejects(
        async () => await addSynonym(testGroupId, '', 'Testicus test'),
        { message: /cannot be empty/ }
      );

      await assert.rejects(
        async () => await addSynonym(testGroupId, '   ', 'Testicus test'),
        { message: /cannot be empty/ }
      );
    });

    test('should throw error for empty scientific name', async () => {
      await assert.rejects(
        async () => await addSynonym(testGroupId, 'Test', ''),
        { message: /cannot be empty/ }
      );

      await assert.rejects(
        async () => await addSynonym(testGroupId, 'Test', '   '),
        { message: /cannot be empty/ }
      );
    });

    test('should throw error for non-existent species group', async () => {
      await assert.rejects(
        async () => await addSynonym(99999, 'Test', 'Testicus test'),
        { message: /not found/ }
      );
    });

    test('should throw error for duplicate synonym', async () => {
      await assert.rejects(
        async () => await addSynonym(testGroupId, 'Test Fish', 'Testicus synonymus'),
        { message: /already exists/ }
      );
    });

    test('should allow same common name with different scientific name', async () => {
      const nameId = await addSynonym(testGroupId, 'Test Fish', 'Testicus synonymus variant');
      assert.ok(nameId > 0);

      const synonyms = await getSynonymsForGroup(testGroupId);
      const testFishVariants = synonyms.filter(s => s.common_name === 'Test Fish');
      assert.strictEqual(testFishVariants.length, 2);
    });

    test('should allow same scientific name with different common name', async () => {
      const nameId = await addSynonym(testGroupId, 'Different Name', 'Testicus synonymus');
      assert.ok(nameId > 0);

      const synonyms = await getSynonymsForGroup(testGroupId);
      const sameScientific = synonyms.filter(s => s.scientific_name === 'Testicus synonymus');
      assert.strictEqual(sameScientific.length, 3);
    });
  });

  describe('updateSynonym', () => {
    let testNameId: number;

    beforeEach(async () => {
      const synonyms = await getSynonymsForGroup(testGroupId);
      testNameId = synonyms[0].name_id;
    });

    test('should update common name only', async () => {
      await updateSynonym(testNameId, { commonName: 'Updated Common Name' });

      const synonyms = await getSynonymsForGroup(testGroupId);
      const updated = synonyms.find(s => s.name_id === testNameId);

      assert.strictEqual(updated?.common_name, 'Updated Common Name');
      assert.strictEqual(updated?.scientific_name, 'Testicus synonymus'); // Unchanged
    });

    test('should update scientific name only', async () => {
      await updateSynonym(testNameId, { scientificName: 'Testicus updated' });

      const synonyms = await getSynonymsForGroup(testGroupId);
      const updated = synonyms.find(s => s.name_id === testNameId);

      assert.strictEqual(updated?.scientific_name, 'Testicus updated');
      // Common name unchanged (either 'Test Fish' or 'Fancy Test Fish')
      assert.ok(updated?.common_name);
    });

    test('should update both fields', async () => {
      await updateSynonym(testNameId, {
        commonName: 'New Common',
        scientificName: 'Testicus newscientific'
      });

      const synonyms = await getSynonymsForGroup(testGroupId);
      const updated = synonyms.find(s => s.name_id === testNameId);

      assert.strictEqual(updated?.common_name, 'New Common');
      assert.strictEqual(updated?.scientific_name, 'Testicus newscientific');
    });

    test('should trim whitespace', async () => {
      await updateSynonym(testNameId, {
        commonName: '  Whitespace  ',
        scientificName: '  Testicus whitespace  '
      });

      const synonyms = await getSynonymsForGroup(testGroupId);
      const updated = synonyms.find(s => s.name_id === testNameId);

      assert.strictEqual(updated?.common_name, 'Whitespace');
      assert.strictEqual(updated?.scientific_name, 'Testicus whitespace');
    });

    test('should throw error if no fields provided', async () => {
      await assert.rejects(
        async () => await updateSynonym(testNameId, {}),
        { message: /at least one field/i }
      );
    });

    test('should throw error for empty common name', async () => {
      await assert.rejects(
        async () => await updateSynonym(testNameId, { commonName: '' }),
        { message: /cannot be empty/ }
      );

      await assert.rejects(
        async () => await updateSynonym(testNameId, { commonName: '   ' }),
        { message: /cannot be empty/ }
      );
    });

    test('should throw error for empty scientific name', async () => {
      await assert.rejects(
        async () => await updateSynonym(testNameId, { scientificName: '' }),
        { message: /cannot be empty/ }
      );
    });

    test('should throw error for non-existent name_id', async () => {
      await assert.rejects(
        async () => await updateSynonym(99999, { commonName: 'Test' }),
        { message: /not found/ }
      );
    });

    test('should throw error for duplicate name combination', async () => {
      const synonyms = await getSynonymsForGroup(testGroupId);
      const otherSynonym = synonyms.find(s => s.name_id !== testNameId);

      await assert.rejects(
        async () => await updateSynonym(testNameId, {
          commonName: otherSynonym!.common_name,
          scientificName: otherSynonym!.scientific_name
        }),
        { message: /already exists/ }
      );
    });
  });

  describe('deleteSynonym', () => {
    let testNameId: number;

    beforeEach(async () => {
      const synonyms = await getSynonymsForGroup(testGroupId);
      testNameId = synonyms[0].name_id;
    });

    test('should delete a synonym', async () => {
      const beforeCount = (await getSynonymsForGroup(testGroupId)).length;

      await deleteSynonym(testNameId);

      const afterSynonyms = await getSynonymsForGroup(testGroupId);
      assert.strictEqual(afterSynonyms.length, beforeCount - 1);
      assert.ok(!afterSynonyms.some(s => s.name_id === testNameId), 'Deleted synonym should not exist');
    });

    test('should prevent deleting last synonym without force', async () => {
      // Create group with only one synonym
      const singleGroupResult = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids', 'Fish', 'Soloicus', 'lonelus')
      `);
      const singleGroupId = singleGroupResult.lastID as number;

      // Use addSynonym to properly add the synonym
      const singleNameId = await addSynonym(singleGroupId, 'Only Name', 'Soloicus lonelus');

      await assert.rejects(
        async () => await deleteSynonym(singleNameId, false),
        { message: /cannot delete the last synonym/i }
      );

      // Synonym should still exist
      const synonyms = await getSynonymsForGroup(singleGroupId);
      assert.strictEqual(synonyms.length, 1);
    });

    test('should allow deleting last synonym with force=true', async () => {
      // Create group with only one synonym
      const singleGroupResult = await db.run(`
        INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
        VALUES ('Cichlids', 'Fish', 'Forcicus', 'deleteus')
      `);
      const singleGroupId = singleGroupResult.lastID as number;

      // Use addSynonym to properly add the synonym
      const singleNameId = await addSynonym(singleGroupId, 'Force Delete Me', 'Forcicus deleteus');

      // Should succeed with force=true
      await deleteSynonym(singleNameId, true);

      const synonyms = await getSynonymsForGroup(singleGroupId);
      assert.strictEqual(synonyms.length, 0, 'Group should have no synonyms');
    });

    test('should throw error for non-existent name_id', async () => {
      await assert.rejects(
        async () => await deleteSynonym(99999),
        { message: /not found/ }
      );
    });

    test('should log warning when deleting synonym used by submissions', async () => {
      // Create member for submission
      const memberResult = await db.run(`
        INSERT INTO members (display_name, contact_email)
        VALUES ('Test Member', 'test@example.com')
      `);
      const memberId = memberResult.lastID as number;

      // Create submission using this synonym
      await db.run(`
        INSERT INTO submissions (
          member_id, species_name_id, species_type, species_class,
          species_common_name, species_latin_name, program,
          water_type, tank_size, filter_type, temperature, ph, gh,
          reproduction_date, submitted_on, approved_on, points
        ) VALUES (?, ?, 'Fish', 'Livebearers', 'Test Fish', 'Testicus synonymus', 'fish',
                  'Fresh', '10g', 'Sponge', '75', '7.0', '200ppm',
                  '2024-01-01', '2024-01-01', '2024-01-15', 10)
      `, [memberId, testNameId]);

      // Should still delete but log warning (we can't easily test logger output in unit tests)
      await deleteSynonym(testNameId);

      const synonyms = await getSynonymsForGroup(testGroupId);
      assert.ok(!synonyms.some(s => s.name_id === testNameId));
    });
  });

  describe('Edge Cases and Data Integrity', () => {
    test('addSynonym should work within transaction rollback scenario', async () => {
      const initialCount = (await getSynonymsForGroup(testGroupId)).length;

      try {
        await db.run('BEGIN TRANSACTION');
        await addSynonym(testGroupId, 'Transaction Test', 'Testicus transaction');
        throw new Error('Simulated error');
      } catch {
        await db.run('ROLLBACK');
      }

      const finalCount = (await getSynonymsForGroup(testGroupId)).length;
      assert.strictEqual(finalCount, initialCount, 'Count should be unchanged after rollback');
    });

    test('should handle unicode characters in names', async () => {
      const nameId = await addSynonym(testGroupId, 'Pez León', 'Pterois volitans');

      const synonyms = await getSynonymsForGroup(testGroupId);
      const unicode = synonyms.find(s => s.name_id === nameId);

      assert.strictEqual(unicode?.common_name, 'Pez León');
    });

    test('should handle very long names within reason', async () => {
      const longCommon = 'A'.repeat(200);
      const longScientific = 'B'.repeat(200);

      const nameId = await addSynonym(testGroupId, longCommon, longScientific);
      assert.ok(nameId > 0);

      const synonyms = await getSynonymsForGroup(testGroupId);
      const longName = synonyms.find(s => s.name_id === nameId);
      assert.strictEqual(longName?.common_name, longCommon);
    });

    test('updateSynonym should maintain referential integrity', async () => {
      const synonyms = await getSynonymsForGroup(testGroupId);
      const nameId = synonyms[0].name_id;

      await updateSynonym(nameId, { commonName: 'Updated Name' });

      // Verify it's still linked to the same group
      const updated = await getSynonymsForGroup(testGroupId);
      const found = updated.find(s => s.name_id === nameId);

      assert.strictEqual(found?.group_id, testGroupId);
    });

    test('should allow deleting synonym even when used by submissions', async () => {
      // Note: The database has foreign key constraint with ON DELETE CASCADE
      // This is expected behavior - we want to track which synonyms are used

      const memberResult = await db.run(`
        INSERT INTO members (display_name, contact_email)
        VALUES ('Test Member', 'test2@example.com')
      `);
      const memberId = memberResult.lastID as number;

      const synonyms = await getSynonymsForGroup(testGroupId);
      const nameId = synonyms[0].name_id;

      await db.run(`
        INSERT INTO submissions (
          member_id, species_name_id, species_type, species_class,
          species_common_name, species_latin_name, program,
          water_type, tank_size, filter_type, temperature, ph, gh,
          reproduction_date
        ) VALUES (?, ?, 'Fish', 'Livebearers', 'Test', 'Testicus test', 'fish',
                  'Fresh', '10g', 'Sponge', '75', '7.0', '200ppm', '2024-01-01')
      `, [memberId, nameId]);

      // Delete should succeed (we have 2 synonyms in testGroupId)
      await deleteSynonym(nameId);

      // Verify deletion
      const remainingSynonyms = await getSynonymsForGroup(testGroupId);
      assert.ok(!remainingSynonyms.some(s => s.name_id === nameId));
    });
  });

  describe('Sequential Batch Operations', () => {
    test('should handle multiple synonym additions sequentially', async () => {
      // Add synonyms one at a time (SQLite transactions don't support parallel writes)
      const nameId1 = await addSynonym(testGroupId, 'Batch 1', 'Testicus batch1');
      const nameId2 = await addSynonym(testGroupId, 'Batch 2', 'Testicus batch2');
      const nameId3 = await addSynonym(testGroupId, 'Batch 3', 'Testicus batch3');

      assert.ok(nameId1 > 0 && nameId2 > 0 && nameId3 > 0);
      assert.strictEqual(new Set([nameId1, nameId2, nameId3]).size, 3, 'All name_ids should be unique');

      const synonyms = await getSynonymsForGroup(testGroupId);
      assert.strictEqual(synonyms.length, 5); // 2 initial + 3 new
    });
  });
});
