import { getWriteDBConnecton, query } from "./conn";

// type as represented in the database
export type MemberRecord = {
	id: number;
	display_name: string;
	contact_email: string;
	is_admin: number
	fish_level?: string;
	plant_level?: string;
	coral_level?: string;
};

export type Member = MemberRecord & {
	points?: number;
}

type AwardRecord = {
	member_id: number;
	award_name: string;
	date_awarded: string;
};

export function getGoogleAccount(sub: string) {
	const members = query<{
		member_id: number,
	}>(`SELECT member_id FROM google_account WHERE google_sub = ?`, [sub]);
	return members.pop();
}

export function createGoogleAccount(memberId: number, sub: string) {
	const db = getWriteDBConnecton()
	try {
		const googleStmt = db.prepare('INSERT INTO google_account (google_sub, member_id) VALUES (?, ?)');
		googleStmt.run(sub, memberId);
	} catch (err) {
		console.error(err);
		throw new Error("Failed to create google account");
	} finally {
		db.close();
	}
}

export function createMember(
	email: string,
	name: string,
	credentials: { google_sub?: string } = {},
	isAdmin: boolean = false,
) {
	try {
		const db = getWriteDBConnecton()
		return db.transaction(() => {
			const userStmt = db.prepare('INSERT INTO members (display_name, contact_email, is_admin) VALUES (?, ?, ?)');
			const memberId = userStmt.run(name, email, isAdmin ? 1 : 0).lastInsertRowid;

			if (credentials.google_sub) {
				const googleStmt = db.prepare('INSERT INTO google_account (google_sub, member_id) VALUES (?, ?)');
				googleStmt.run(credentials.google_sub, memberId);
			}
			return memberId as number;
		})();
	} catch (err) {
		console.error(err);
		throw new Error("Failed to create member");
	}
}

export function getMember(id: number) {
	const members = query<MemberRecord>(
		`SELECT * FROM members WHERE id = ?`,
		[id],
	);
	return members.pop();
}

export function updateMember(memberId: number, updates: Partial<MemberRecord>) {
	const fields = Object.keys(updates);
	const values = Object.values(updates);
	const setClause = fields.map(field => `${field} = ?`).join(', ');

	try {
		const conn = getWriteDBConnecton();
		const stmt = conn.prepare(`UPDATE members SET ${setClause} WHERE id = ?`);
		const result = stmt.run(...values, memberId);
		conn.close();
		return result.changes;
	} catch (err) {
		console.error(err);
		throw new Error("Failed to update member");
	}
}

export function getMemberByEmail(email: string) {
	const members = query<MemberRecord>(
		`SELECT * FROM members WHERE contact_email = ?`,
		[email],
	);
	return members.pop();
}

export function getMembersList(): MemberRecord[] {
	return query(`SELECT id, display_name, fish_level, plant_level, coral_level FROM members`);
}

export function getRoster() {
	return query<MemberRecord>(`SELECT * FROM members`);
}

export function getMemberWithAwards(memberId: number) {
	const members = query<MemberRecord>(`SELECT * FROM members WHERE id = ?`, [memberId]);
	const member = members.pop();
	const awards = query<AwardRecord>(`SELECT * FROM awards WHERE member_id = ?`, [memberId]);
	return {...member, awards};
}

export function grantAward(memberId: number, awardName: string, dateAwarded: Date) {
	try {
		const conn = getWriteDBConnecton();
		const stmt = conn.prepare(`INSERT INTO awards (member_id, award_name, date_awarded) VALUES (?, ?, ?)`);
		stmt.run(memberId, awardName, dateAwarded.toISOString());
		conn.close();
	} catch (err) {
		console.error(err);
		throw new Error("Failed to grant award");
	}
}
