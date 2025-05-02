import { makePasswordEntry, ScryptPassword } from "@/auth";
import { writeConn, query } from "./conn";

// type as represented in the database
export type MemberRecord = {
	id: number;
	display_name: string;
	contact_email: string;
	is_admin: number;
	fish_level?: string;
	plant_level?: string;
	coral_level?: string;
};

export type Member = MemberRecord & {
	points?: number;
};

type AwardRecord = {
	member_id: string;
	award_name: string;
	date_awarded: string;
};

export async function getGoogleAccount(sub: string) {
	const members = await query<{
		google_sub: string,
		member_id: number,
		google_email: string,
	}>(`SELECT google_sub, member_id, google_email FROM google_account WHERE google_sub = ?`, [sub]);
	return members.pop();
}

export async function getGoogleAccountByMemberId(member_id: number) {
	const members = await query<{
		google_sub: string,
		member_id: number,
		google_email: string,
	}>(`SELECT google_sub, member_id, google_email FROM google_account WHERE member_id = ?`, [member_id]);
	return members.pop()
}

export async function deleteGoogleAccount(sub: string, memberId: number) {
	try {
		const conn = writeConn;
		const deleteRow = await conn.prepare("DELETE FROM google_account WHERE google_sub = ? AND member_id = ?");
		return deleteRow.run(sub, memberId);
	} catch (err) {
		console.error(err);
		throw new Error("Failed to delete google account");
	}
}

export async function getMemberPassword(memberId: number) {
	const members = await query<ScryptPassword>(`SELECT * FROM password_account WHERE member_id = ?`, [memberId]);
	return members.pop();
}

export async function createOrUpdatePassword(memberId: number, passwordEntry: ScryptPassword) {
	const db = writeConn;
	try {
		const stmt = await db.prepare(`
			INSERT INTO password_account (member_id, N, r, p, salt, hash) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(member_id) DO UPDATE SET
				N = excluded.N,
				r = excluded.r,
				p = excluded.p,
				salt = excluded.salt,
				hash = excluded.hash
			`);
		const { N, r, p, salt, hash } = passwordEntry;
		stmt.run(memberId, N, r, p, salt, hash);
	} catch (err) {
		console.error(err);
		throw new Error("Failed to set password");
	}
}

export async function createGoogleAccount(memberId: number, sub: string, email: string) {
	const db = writeConn;
	try {
		const googleStmt = await db.prepare('INSERT INTO google_account (google_sub, member_id, google_email) VALUES (?, ?, ?)');
		await googleStmt.run(sub, memberId, email);
	} catch (err) {
		console.error(err);
		throw new Error("Failed to create google account");
	}
}

export async function createMember(
	email: string,
	name: string,
	credentials: {
		password?: string,
		google_sub?: string
	} = {},
	isAdmin: boolean = false,
) {
	const db = writeConn;
	await db.exec('BEGIN TRANSACTION;');

	try {
		const userStmt = await db.prepare('INSERT INTO members (display_name, contact_email, is_admin) VALUES (?, ?, ?)');
		const memberId = (await userStmt.run(name, email, isAdmin ? 1 : 0)).lastID;

		if (credentials.google_sub) {
			const googleStmt = await db.prepare('INSERT INTO google_account (google_sub, member_id) VALUES (?, ?)');
			await googleStmt.run(credentials.google_sub, memberId);
		}

		if (credentials.password) {
			const { N, r, p, salt, hash	} = await makePasswordEntry(credentials.password);
			const googleStmt = await db.prepare('INSERT INTO password_account (member_id, N, r, p, salt, hash) VALUES (?, ?, ?, ?, ?, ?)');
			await googleStmt.run(memberId, N, r, p, salt, hash);
		}

		await db.exec('COMMIT;');
		return memberId as number;

	} catch (err) {
		await db.exec('ROLLBACK;');
		console.error(err);
		throw new Error("Failed to create member");
	}
}

export async function getMember(id: number) {
	const members = await query<MemberRecord>("SELECT * FROM members WHERE id = ?",	[id]);
	return members.pop();
}

export async function updateMember(memberId: number, updates: Partial<MemberRecord>) {
	const fields = Object.keys(updates);
	const values = Object.values(updates);
	const setClause = fields.map((field) => `${field} = ?`).join(", ");
	const conn = writeConn;
	try {
		const stmt = await conn.prepare(`UPDATE members SET ${setClause} WHERE id = ?`);
		const result = await stmt.run(...values, memberId);
		return result.changes;
	} catch (err) {
		console.error(err);
		throw new Error("Failed to update member");
	}
}

export async function getMemberByEmail(email: string) {
	const members = await query<MemberRecord>("SELECT * FROM members WHERE contact_email = ?", [email]);
	return members.pop();
}

export async function getMembersList(): Promise<MemberRecord[]> {
	return query<MemberRecord>("SELECT id, display_name, fish_level, plant_level, coral_level FROM members");
}

export async function getRoster() {
	return query<MemberRecord>(`SELECT * FROM members`);
}

export async function getMemberWithAwards(memberId: string) {
	const [members, awards] = await Promise.all([
		query<MemberRecord>("SELECT * FROM members WHERE id = ?", [memberId]),
		query<AwardRecord>("SELECT * FROM awards WHERE member_id = ?", [memberId]),
	]);
	const member = members.pop();
	return { ...member, awards };
}

export async function grantAward(memberId: number, awardName: string, dateAwarded: Date) {
	try {
		const conn = writeConn;
		const stmt = await conn.prepare("INSERT INTO awards (member_id, award_name, date_awarded) VALUES (?, ?, ?)");
		await stmt.run(memberId, awardName, dateAwarded.toISOString());
	} catch (err) {
		console.error(err);
		throw new Error("Failed to grant award");
	}
}
