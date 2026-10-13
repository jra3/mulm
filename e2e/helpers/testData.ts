import { open, Database } from "sqlite";
import sqlite3 from "sqlite3";
import { e2eDatabaseFile } from "./database";
import { makePasswordEntry } from "../../src/auth";

/**
 * Helper to seed test data for E2E tests
 */

/**
 * Compatibility alias assigned by the test-scoped fixture before beforeEach.
 */
export const TEST_USER = {
  email: "unallocated-member@example.invalid",
  password: "TestPassword123!",
  displayName: "E2E Test User",
};

/**
 * Compatibility alias for the current test's committee member.
 */
export const TEST_ADMIN = {
  email: "unallocated-committee@example.invalid",
  password: "AdminPassword123!",
  displayName: "E2E Test Admin",
};

export async function getTestDatabase(): Promise<Database> {
  const dbPath = e2eDatabaseFile();
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READWRITE,
  });
  await db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;");
  return db;
}

/**
 * Create a test user if it doesn't exist
 */
export async function ensureTestUserExists(
  email: string,
  password: string,
  displayName: string,
  isAdmin = false
): Promise<number> {
  const db = await getTestDatabase();

  try {
    // Check if user exists
    const existing = await db.get<{ id: number }>(
      "SELECT id FROM members WHERE contact_email = ?",
      email
    );

    if (existing) {
      // Update admin status if needed
      if (isAdmin) {
        await db.run("UPDATE members SET is_admin = ? WHERE id = ?", 1, existing.id);
      }

      // Ensure password account exists
      const passwordAccount = await db.get(
        "SELECT * FROM password_account WHERE member_id = ?",
        existing.id
      );
      if (!passwordAccount) {
        const passwordEntry = await makePasswordEntry(password);
        await db.run(
          `INSERT INTO password_account (member_id, N, r, p, salt, hash) VALUES (?, ?, ?, ?, ?, ?)`,
          existing.id,
          passwordEntry.N,
          passwordEntry.r,
          passwordEntry.p,
          passwordEntry.salt,
          passwordEntry.hash
        );
      }

      return existing.id;
    }

    // Create the user
    const passwordEntry = await makePasswordEntry(password);

    const result = await db.run(
      `INSERT INTO members (contact_email, display_name, is_admin) VALUES (?, ?, ?)`,
      email,
      displayName,
      isAdmin ? 1 : 0
    );

    const memberId = result.lastID as number;

    // Create password account using scrypt parameters
    await db.run(
      `INSERT INTO password_account (member_id, N, r, p, salt, hash) VALUES (?, ?, ?, ?, ?, ?)`,
      memberId,
      passwordEntry.N,
      passwordEntry.r,
      passwordEntry.p,
      passwordEntry.salt,
      passwordEntry.hash
    );

    return memberId;
  } finally {
    await db.close();
  }
}

/**
 * Create a test submission for a member
 */
export async function createTestSubmission(
  memberId: number,
  options: {
    speciesType?: string;
    speciesCommonName?: string;
    speciesLatinName?: string;
    isDraft?: boolean;
  } = {}
): Promise<number> {
  const db = await getTestDatabase();

  try {
    const {
      speciesType = "Fish",
      speciesCommonName = "Test Guppy",
      speciesLatinName = "Poecilia reticulata",
      isDraft = true,
    } = options;

    const result = await db.run(
      `
			INSERT INTO submissions (
				member_id, species_type, species_class, species_common_name, species_latin_name,
				reproduction_date, temperature, ph, submitted_on, program
			 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
      memberId,
      speciesType,
      speciesType === "Plant" ? "Cryptocoryne" : speciesType === "Coral" ? "Hard" : "Livebearers",
      speciesCommonName,
      speciesLatinName,
      new Date().toISOString(),
      "75",
      "7.0",
      isDraft ? null : new Date().toISOString(),
      speciesType === "Invert" ? "fish" : speciesType.toLowerCase()
    );

    const submissionId = result.lastID as number;
    return submissionId;
  } finally {
    await db.close();
  }
}

/**
 * Delete a submission by ID
 */
export async function deleteSubmission(submissionId: number): Promise<void> {
  const db = await getTestDatabase();

  try {
    await db.run("DELETE FROM submissions WHERE id = ?", submissionId);
  } finally {
    await db.close();
  }
}

/**
 * Get all submissions for a member
 */
export async function getSubmissionsForMember(memberId: number): Promise<any[]> {
  const db = await getTestDatabase();

  try {
    return await db.all("SELECT * FROM submissions WHERE member_id = ? ORDER BY id DESC", memberId);
  } finally {
    await db.close();
  }
}

/**
 * Clean up test user's submissions
 */
export async function cleanupTestUserSubmissions(email: string): Promise<void> {
  const db = await getTestDatabase();

  try {
    const user = await db.get<{ id: number }>(
      "SELECT id FROM members WHERE contact_email = ?",
      email
    );

    if (user) {
      await db.run("DELETE FROM submissions WHERE member_id = ?", user.id);
    }
  } finally {
    await db.close();
  }
}

/** Membership is the ownership boundary, including Submissions made through UI. */
export async function removeOwnedMembers(ids: readonly number[]): Promise<void> {
  const connection = await getTestDatabase();
  try {
    await connection.exec("BEGIN IMMEDIATE");
    for (const id of ids) {
      await connection.run("DELETE FROM submissions WHERE member_id = ?", id);
    }
    for (const id of ids) await connection.run("DELETE FROM members WHERE id = ?", id);
    await connection.exec("COMMIT");
  } catch (error) {
    await connection.exec("ROLLBACK");
    throw error;
  } finally {
    await connection.close();
  }
}
