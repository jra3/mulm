import { Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { overrideConnection } from '../db/conn';
import { createMember } from '../db/members';

export interface TestDatabase {
  db: Database;
  cleanup: () => Promise<void>;
}

export interface TestMember {
  id: number;
  display_name: string;
  contact_email: string;
  is_admin?: number | boolean;
}

/**
 * Creates a fresh in-memory SQLite database for testing
 * Runs migrations and overrides the global database connection
 */
export async function setupTestDatabase(): Promise<TestDatabase> {
  const db = await open({
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

  const cleanup = async () => {
    try {
      await db.close();
    } catch {
      // Ignore close errors in tests
    }
  };

  return { db, cleanup };
}

/**
 * Creates test members with unique email addresses
 * Returns created member objects with their IDs
 */
export async function createTestMembers(count: number = 1): Promise<TestMember[]> {
  const members: TestMember[] = [];
  
  for (let i = 0; i < count; i++) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const email = `test-member-${timestamp}-${i}-${random}@test.com`;
    const displayName = `Test Member ${i + 1}`;
    
    const memberId = await createMember(email, displayName);
    const { getMember } = await import('../db/members');
    const member = await getMember(memberId) as TestMember;
    
    members.push(member);
  }
  
  return members;
}

/**
 * Creates a test species with split schema and returns both name IDs
 * This is needed for proper foreign key relationships in tests
 */
export async function createTestSpeciesName(
  db: Database,
  commonName: string = 'Test Fish',
  scientificName: string = 'Testus fishus',
  genus: string = 'Testus',
  species: string = 'fishus',
  programClass: string = 'Freshwater'
): Promise<{ common_name_id: number; scientific_name_id: number; group_id: number }> {
  // First create or get the species name group
  await db.run(`
    INSERT OR IGNORE INTO species_name_group (program_class, canonical_genus, canonical_species_name, species_type)
    VALUES (?, ?, ?, 'Fish')
  `, [programClass, genus, species]);

  const group = await db.get<{ group_id: number }>(`
    SELECT group_id FROM species_name_group
    WHERE canonical_genus = ? AND canonical_species_name = ?
  `, [genus, species]);

  if (!group) {
    throw new Error('Failed to create or find species name group');
  }

  // Create the common name
  const commonResult = await db.run(`
    INSERT INTO species_common_name (group_id, common_name)
    VALUES (?, ?)
  `, [group.group_id, commonName]);

  // Create the scientific name
  const scientificResult = await db.run(`
    INSERT INTO species_scientific_name (group_id, scientific_name)
    VALUES (?, ?)
  `, [group.group_id, scientificName]);

  return {
    common_name_id: commonResult.lastID as number,
    scientific_name_id: scientificResult.lastID as number,
    group_id: group.group_id
  };
}

/**
 * Creates a test submission with the given parameters
 * Returns the submission ID
 */
export async function createTestSubmission(
  db: Database,
  memberId: number,
  speciesType: string = 'Fish',
  speciesClass: string = 'New World',
  status: string = 'pending'
): Promise<number> {
  // Create test species with split schema
  const speciesIds = await createTestSpeciesName(db);

  const result = await db.run(`
    INSERT INTO submissions (
      member_id, species_class, species_type, species_common_name,
      species_latin_name, common_name_id, scientific_name_id,
      reproduction_date, temperature, ph, gh,
      specific_gravity, water_type, witness_verification_status,
      program, submitted_on
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    memberId, speciesClass, speciesType, 'Test Fish', 'Testus fishus',
    speciesIds.common_name_id, speciesIds.scientific_name_id,
    new Date().toISOString(), '75', '7.0', '10', '1.000', 'Fresh',
    status, speciesType.toLowerCase(), new Date().toISOString()
  ]);

  return result.lastID as number;
}

/**
 * Utility function to create multiple test submissions
 */
export async function createMultipleTestSubmissions(
  db: Database,
  count: number, 
  memberId: number,
  speciesType: string = 'Fish',
  speciesClass: string = 'New World'
): Promise<number[]> {
  const submissions: number[] = [];
  for (let i = 0; i < count; i++) {
    const id = await createTestSubmission(db, memberId, speciesType, speciesClass);
    submissions.push(id);
  }
  return submissions;
}

/**
 * Jest suite-level database fixture
 * Sets up beforeEach and afterEach hooks for database management
 */
export function useTestDatabase() {
  let testDb: TestDatabase;
  
  beforeEach(async () => {
    testDb = await setupTestDatabase();
  });

  afterEach(async () => {
    if (testDb) {
      await testDb.cleanup();
    }
  });

  return {
    getDb: () => testDb.db,
    getTestDb: () => testDb
  };
}