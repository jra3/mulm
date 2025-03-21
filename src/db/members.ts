import { getWriteDBConnecton, query } from "./conn";

export type MemberRecord = {
	id: number;
	name: string;
	is_admin: number;
	fish_level?: string;
	plant_level?: string;
	coral_level?: string;
};

type AwardRecord = {
	member_id: number;
	award_name: string;
	date_awarded: string;
};

export function getOrCreateMember(email: string, name: string) {
	try {
		const conn = getWriteDBConnecton()
		const insertStmt = conn.prepare(`
			INSERT INTO members (email, name) VALUES (?, ?)
			ON CONFLICT(email) DO NOTHING;
		`);
		insertStmt.run(email, name);
		const selectStmt = conn.prepare(`SELECT id, name FROM members WHERE name = ?`);
		return selectStmt.get(name) as {name: string, id: number};
	} catch (err) {
		console.error(err);
		throw new Error("Failed to get member");
	}
}

export function getMembersList(): MemberRecord[] {
	return query<{
		id: number,
		name: string
		is_admin: number,
		fish_level?: string,
		plant_level?: string,
		coral_level?: string,
	}>(`SELECT id, name, is_admin, fish_level, plant_level, coral_level FROM members`);
}


export function getMemberData(memberId: number) {
	const members = query<MemberRecord>(`SELECT * FROM members WHERE id = ?`, [memberId]);
	const member = members.pop();
	const awards = query<AwardRecord>(`SELECT * FROM awards WHERE member_id = ?`, [memberId]);
	return {...member, awards};
}

export function updateMemberData(memberId: number, updates: Partial<MemberRecord>) {
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
