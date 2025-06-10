import { makePasswordEntry, ScryptPassword } from "../auth";
import { db, query, deleteOne, insertOne, updateOne } from "./conn";

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

const googleAccountTableName = "google_account";

export async function getGoogleAccount(sub: string) {
	const members = await query<{
		google_sub: string,
		member_id: number,
		google_email: string,
	}>(`SELECT google_sub, member_id, google_email FROM ${googleAccountTableName} WHERE google_sub = ?`, [sub]);
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

export async function createGoogleAccount(memberId: number, sub: string, email: string) {
	return insertOne(googleAccountTableName, {
		member_id: memberId,
		google_sub: sub,
		google_email: email,
	})
}

export async function deleteGoogleAccount(sub: string, memberId: number) {
	return deleteOne(googleAccountTableName, { google_sub: sub, member_id: memberId });
}

export async function createOrUpdatePassword(memberId: number, passwordEntry: ScryptPassword) {
	const conn = db(true);
	try {
		const stmt = await conn.prepare(`
			INSERT INTO password_account (member_id, N, r, p, salt, hash) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(member_id) DO UPDATE SET
				N = excluded.N,
				r = excluded.r,
				p = excluded.p,
				salt = excluded.salt,
				hash = excluded.hash
			`);
		const { N, r, p, salt, hash } = passwordEntry;
		await stmt.run(memberId, N, r, p, salt, hash);
	} catch (err) {
		console.error(err);
		throw new Error("Failed to set password");
	}
}

export async function getMemberPassword(memberId: number) {
	const members = await query<ScryptPassword>(`SELECT * FROM password_account WHERE member_id = ?`, [memberId]);
	return members.pop();
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
	const conn = db(true); 
	await conn.exec('BEGIN TRANSACTION;');

	try {
		const userStmt = await conn.prepare('INSERT INTO members (display_name, contact_email, is_admin) VALUES (?, ?, ?)');
		// is this a bug... we should return the data, not the lastID
		const memberId = (await userStmt.run(name, email, isAdmin ? 1 : 0)).lastID;

		if (credentials.google_sub) {
			const googleStmt = await conn.prepare('INSERT INTO google_account (google_sub, member_id, google_email) VALUES (?, ?, ?)');
			await googleStmt.run(credentials.google_sub, memberId, email);
		}

		if (credentials.password) {
			const { N, r, p, salt, hash	} = await makePasswordEntry(credentials.password);
			const googleStmt = await conn.prepare('INSERT INTO password_account (member_id, N, r, p, salt, hash) VALUES (?, ?, ?, ?, ?, ?)');
			await googleStmt.run(memberId, N, r, p, salt, hash);
		}

		await conn.exec('COMMIT;');
		return memberId as number;

	} catch (err) {
		console.error(err);
		await conn.exec('ROLLBACK;');
		throw new Error("Failed to create member");
	}
}

export async function getMember(id: number) {
	const members = await query<MemberRecord>("SELECT * FROM members WHERE id = ?",	[id]);
	return members.pop();
}

export async function updateMember(memberId: number, updates: Partial<MemberRecord>) {
	return updateOne("members", { id: memberId }, updates);
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
		const conn = db(true);
		const stmt = await conn.prepare("INSERT INTO awards (member_id, award_name, date_awarded) VALUES (?, ?, ?)");
		await stmt.run(memberId, awardName, dateAwarded.toISOString());
	} catch (err) {
		console.error(err);
		throw new Error("Failed to grant award");
	}
}

// Currently this is a full table scan. Oh well.
export async function getAdminEmails(): Promise<string[]> {
	const rows = await query<{ contact_email: string }>(`SELECT contact_email FROM members where is_admin = 1`);
	return rows.map((row) => row.contact_email);
}
