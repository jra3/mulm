import { open, Database } from "sqlite";
import sqlite3 from "sqlite3";
import path from "path";
import { makePasswordEntry } from "../../src/auth";

/**
 * Helper to seed test data for E2E tests
 */

/**
 * Default test user credentials
 */
export const TEST_USER = {
	email: "baptest+e2e@porcnick.com",
	password: "TestPassword123!",
	displayName: "E2E Test User",
};

/**
 * Test admin user credentials
 */
export const TEST_ADMIN = {
	email: "baptest+admin@porcnick.com",
	password: "AdminPassword123!",
	displayName: "E2E Test Admin",
};

export async function getTestDatabase(): Promise<Database> {
	const dbPath = path.join(__dirname, "../../db/database.db");
	return await open({
		filename: dbPath,
		driver: sqlite3.Database,
		mode: sqlite3.OPEN_READWRITE,
	});
}

/**
 * Create a test user if it doesn't exist
 */
export async function ensureTestUserExists(email: string, password: string, displayName: string, isAdmin = false): Promise<number> {
	const db = await getTestDatabase();

	try {
		// Check if user exists
		const existing = await db.get<{ id: number }>("SELECT id FROM members WHERE contact_email = ?", email);

		if (existing) {
			console.log(`Test user ${email} already exists (ID: ${existing.id})`);

			// Update admin status if needed
			if (isAdmin) {
				await db.run("UPDATE members SET is_admin = ? WHERE id = ?", 1, existing.id);
			}

			// Ensure password account exists
			const passwordAccount = await db.get("SELECT * FROM password_account WHERE member_id = ?", existing.id);
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
				console.log(`Added password account for ${email}`);
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

		console.log(`Created test user ${email} (ID: ${memberId})`);
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
				member_id, species_type, species_common_name, species_latin_name,
				reproduction_date, temperature, ph, submitted_on, program
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			memberId,
			speciesType,
			speciesCommonName,
			speciesLatinName,
			new Date().toISOString(),
			"75",
			"7.0",
			isDraft ? null : new Date().toISOString(),
			speciesType.toLowerCase()
		);

		const submissionId = result.lastID as number;
		console.log(`Created test submission ${submissionId} for member ${memberId}`);
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
		console.log(`Deleted submission ${submissionId}`);
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
		const user = await db.get<{ id: number }>("SELECT id FROM members WHERE contact_email = ?", email);

		if (user) {
			await db.run("DELETE FROM submissions WHERE member_id = ?", user.id);
			console.log(`Cleaned up submissions for ${email}`);
		}
	} finally {
		await db.close();
	}
}

