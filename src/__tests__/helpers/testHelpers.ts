/**
 * Test Helper Utilities for Mulm BAP Testing
 *
 * Provides centralized helpers for:
 * - Database setup/teardown
 * - Test fixture factories (members, submissions, species)
 * - Common test assertions
 * - Mock data generation
 *
 * Usage:
 * ```typescript
 * import { setupTestDatabase, createTestMember, createTestSubmission } from './helpers/testHelpers';
 *
 * let ctx: TestContext;
 *
 * beforeEach(async () => {
 *   ctx = await setupTestDatabase();
 * });
 *
 * afterEach(async () => {
 *   await teardownTestDatabase(ctx);
 * });
 * ```
 */

import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../../db/conn";
import { createMember, getMember } from "../../db/members";

/**
 * Test context containing database and common test fixtures
 */
export interface TestContext {
  db: Database;
  member: TestMember;
  admin: TestMember;
  otherAdmin?: TestMember;
}

/**
 * Test member interface
 */
export interface TestMember {
  id: number;
  display_name: string;
  contact_email: string;
}

/**
 * Options for database setup
 */
export interface DatabaseSetupOptions {
  /**
   * Number of admin users to create (default: 1)
   */
  adminCount?: 1 | 2 | 3;

  /**
   * Number of regular members to create (default: 1)
   */
  memberCount?: number;

  /**
   * Whether to enable foreign key constraints (default: false for simpler testing)
   */
  enableForeignKeys?: boolean;
}

/**
 * Sets up an in-memory test database with migrations and test users
 *
 * @param options - Configuration options for database setup
 * @returns TestContext with database and test users
 *
 * @example
 * ```typescript
 * const ctx = await setupTestDatabase({ adminCount: 2, memberCount: 1 });
 * ```
 */
export async function setupTestDatabase(
  options: DatabaseSetupOptions = {}
): Promise<TestContext> {
  const { adminCount = 1, memberCount = 1, enableForeignKeys = false } = options;

  // Create fresh in-memory database
  const db = await open({
    filename: ":memory:",
    driver: sqlite3.Database,
  });

  // Configure foreign key constraints
  if (enableForeignKeys) {
    await db.exec("PRAGMA foreign_keys = ON;");
  } else {
    await db.exec("PRAGMA foreign_keys = OFF;");
  }

  // Run migrations
  await db.migrate({
    migrationsPath: "./db/migrations",
  });

  // Override the global connection
  overrideConnection(db);

  // Create test users
  const timestamp = Date.now();
  const memberEmail = `member-${timestamp}@test.com`;
  const adminEmail = `admin-${timestamp}@test.com`;

  const memberId = await createMember(memberEmail, "Test Member");
  const adminId = await createMember(adminEmail, "Test Admin");

  const member = (await getMember(memberId)) as TestMember;
  const admin = (await getMember(adminId)) as TestMember;

  const context: TestContext = {
    db,
    member,
    admin,
  };

  // Create additional admin if requested
  if (adminCount >= 2) {
    const otherAdminEmail = `admin2-${timestamp}@test.com`;
    const otherAdminId = await createMember(otherAdminEmail, "Other Admin");
    context.otherAdmin = (await getMember(otherAdminId)) as TestMember;
  }

  // Create additional members if requested
  if (memberCount > 1) {
    for (let i = 2; i <= memberCount; i++) {
      await createMember(`member${i}-${timestamp}@test.com`, `Test Member ${i}`);
    }
  }

  return context;
}

/**
 * Tears down the test database
 *
 * @param ctx - Test context to clean up
 *
 * @example
 * ```typescript
 * await teardownTestDatabase(ctx);
 * ```
 */
export async function teardownTestDatabase(ctx: TestContext): Promise<void> {
  try {
    await ctx.db.close();
  } catch {
    // Ignore close errors in tests
  }
}

/**
 * Options for creating a test submission
 */
export interface CreateSubmissionOptions {
  /**
   * Member ID who owns the submission
   */
  memberId: number;

  /**
   * Whether submission has been submitted (default: false)
   */
  submitted?: boolean;

  /**
   * Witness verification status (default: "pending")
   */
  witnessStatus?: "pending" | "confirmed" | "declined";

  /**
   * Whether submission has been approved (default: false)
   */
  approved?: boolean;

  /**
   * Whether submission has been denied (default: false)
   */
  denied?: boolean;

  /**
   * Whether changes have been requested (default: false)
   */
  changesRequested?: boolean;

  /**
   * Admin ID who witnessed the submission (required if witnessStatus is not "pending")
   */
  witnessedBy?: number;

  /**
   * Admin ID who approved the submission (required if approved is true)
   */
  approvedBy?: number;

  /**
   * Admin ID who denied the submission (required if denied is true)
   */
  deniedBy?: number;

  /**
   * Admin ID who requested changes (required if changesRequested is true)
   */
  changesRequestedBy?: number;

  /**
   * Points awarded (only if approved)
   */
  points?: number;

  /**
   * Article points (only if approved)
   */
  articlePoints?: number;

  /**
   * First time species bonus flag
   */
  firstTimeSpecies?: boolean;

  /**
   * CARES species bonus flag
   */
  caresSpecies?: boolean;

  /**
   * Species type (default: "Fish")
   */
  speciesType?: "Fish" | "Plant" | "Invert" | "Coral";

  /**
   * Species class (default: "Livebearers")
   */
  speciesClass?: string;

  /**
   * Common name (default: "Guppy")
   */
  commonName?: string;

  /**
   * Latin name (default: "Poecilia reticulata")
   */
  latinName?: string;

  /**
   * Program (default: "fish")
   */
  program?: "fish" | "plant" | "coral";

  /**
   * Reproduction date (default: now)
   */
  reproductionDate?: string;

  /**
   * Foods array as JSON string (default: '["Flakes","Live food"]')
   */
  foods?: string;

  /**
   * Spawn locations array as JSON string (default: '["Plants","Spawning mop"]')
   */
  spawnLocations?: string;
}

/**
 * Creates a test submission in the database with specified state
 *
 * @param db - Database connection
 * @param options - Submission configuration
 * @returns Submission ID
 *
 * @example
 * ```typescript
 * const submissionId = await createTestSubmission(ctx.db, {
 *   memberId: ctx.member.id,
 *   submitted: true,
 *   witnessStatus: "confirmed",
 *   witnessedBy: ctx.admin.id,
 * });
 * ```
 */
export async function createTestSubmission(
  db: Database,
  options: CreateSubmissionOptions
): Promise<number> {
  const now = new Date().toISOString();

  const {
    memberId,
    submitted = false,
    witnessStatus = "pending",
    approved = false,
    denied = false,
    changesRequested = false,
    witnessedBy,
    approvedBy,
    deniedBy,
    changesRequestedBy,
    points,
    articlePoints = 0,
    firstTimeSpecies = false,
    caresSpecies = false,
    speciesType = "Fish",
    speciesClass = "Livebearers",
    commonName = "Guppy",
    latinName = "Poecilia reticulata",
    program = "fish",
    reproductionDate = now,
    foods = '["Flakes","Live food"]',
    spawnLocations = '["Plants","Spawning mop"]',
  } = options;

  const result = await db.run(
    `INSERT INTO submissions (
      member_id, species_class, species_type, species_common_name,
      species_latin_name, reproduction_date, temperature, ph, gh,
      water_type, witness_verification_status, program,
      submitted_on, witnessed_by, witnessed_on,
      approved_on, approved_by, points, article_points,
      first_time_species, cares_species,
      denied_on, denied_by, denied_reason,
      changes_requested_on, changes_requested_by, changes_requested_reason,
      foods, spawn_locations
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      memberId,
      speciesClass,
      speciesType,
      commonName,
      latinName,
      reproductionDate,
      "75",
      "7.0",
      "150",
      "Fresh",
      witnessStatus,
      program,
      submitted ? now : null,
      witnessedBy || (witnessStatus !== "pending" ? witnessedBy : null),
      witnessStatus !== "pending" ? now : null,
      approved ? now : null,
      approvedBy || (approved ? approvedBy : null),
      approved ? points || 10 : null,
      approved ? articlePoints : null,
      approved ? (firstTimeSpecies ? 1 : 0) : null,
      approved ? (caresSpecies ? 1 : 0) : null,
      denied ? now : null,
      deniedBy || (denied ? deniedBy : null),
      denied ? "Test denial reason" : null,
      changesRequested ? now : null,
      changesRequestedBy || (changesRequested ? changesRequestedBy : null),
      changesRequested ? "Test change request" : null,
      foods,
      spawnLocations,
    ]
  );

  return result.lastID as number;
}

/**
 * Options for creating a test member
 */
export interface CreateMemberOptions {
  /**
   * Display name (default: auto-generated)
   */
  displayName?: string;

  /**
   * Contact email (default: auto-generated)
   */
  email?: string;

  /**
   * Whether member is an admin (default: false)
   */
  isAdmin?: boolean;
}

/**
 * Creates a test member
 *
 * @param options - Member configuration
 * @returns TestMember
 *
 * @example
 * ```typescript
 * const newMember = await createTestMember({ displayName: "Jane Doe", isAdmin: true });
 * ```
 */
export async function createTestMember(
  options: CreateMemberOptions = {}
): Promise<TestMember> {
  const timestamp = Date.now();
  const { displayName = `Test User ${timestamp}`, email = `user-${timestamp}@test.com` } = options;

  const memberId = await createMember(email, displayName);
  return (await getMember(memberId)) as TestMember;
}

/**
 * Mock approval data for testing
 */
export const mockApprovalData = {
  id: 0,
  group_id: 1,
  points: 10,
  article_points: 0,
  first_time_species: false,
  cares_species: false,
  flowered: false,
  sexual_reproduction: false,
};

/**
 * Mock species IDs for testing
 */
export const mockSpeciesIds = {
  common_name_id: 1,
  scientific_name_id: 1,
};

/**
 * Generates a unique timestamp-based email for testing
 *
 * @param prefix - Email prefix (default: "test")
 * @returns Email address
 *
 * @example
 * ```typescript
 * const email = generateTestEmail("member"); // "member-1234567890@test.com"
 * ```
 */
export function generateTestEmail(prefix = "test"): string {
  return `${prefix}-${Date.now()}@test.com`;
}

/**
 * Assertion helper for testing submission state
 *
 * @param submission - Submission to test
 * @param expected - Expected state
 *
 * @example
 * ```typescript
 * assertSubmissionState(submission, {
 *   submitted: true,
 *   witnessed: true,
 *   approved: false,
 * });
 * ```
 */
export function assertSubmissionState(
  submission: {
    submitted_on: string | null;
    witnessed_on: string | null;
    approved_on: string | null;
    denied_on: string | null;
  },
  expected: {
    submitted?: boolean;
    witnessed?: boolean;
    approved?: boolean;
    denied?: boolean;
  }
): void {
  if (expected.submitted !== undefined) {
    if (expected.submitted) {
      if (submission.submitted_on === null) {
        throw new Error("Expected submission to be submitted, but submitted_on is null");
      }
    } else {
      if (submission.submitted_on !== null) {
        throw new Error("Expected submission to not be submitted, but submitted_on is not null");
      }
    }
  }

  if (expected.witnessed !== undefined) {
    if (expected.witnessed) {
      if (submission.witnessed_on === null) {
        throw new Error("Expected submission to be witnessed, but witnessed_on is null");
      }
    } else {
      if (submission.witnessed_on !== null) {
        throw new Error("Expected submission to not be witnessed, but witnessed_on is not null");
      }
    }
  }

  if (expected.approved !== undefined) {
    if (expected.approved) {
      if (submission.approved_on === null) {
        throw new Error("Expected submission to be approved, but approved_on is null");
      }
    } else {
      if (submission.approved_on !== null) {
        throw new Error("Expected submission to not be approved, but approved_on is not null");
      }
    }
  }

  if (expected.denied !== undefined) {
    if (expected.denied) {
      if (submission.denied_on === null) {
        throw new Error("Expected submission to be denied, but denied_on is null");
      }
    } else {
      if (submission.denied_on !== null) {
        throw new Error("Expected submission to not be denied, but denied_on is not null");
      }
    }
  }
}
