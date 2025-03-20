import { getWriteDBConnecton, query } from "./conn";

type MemberRecord = {
	id: number;
	name: string;
};

type AwardRecord = {
	member_id: number;
	award_name: string;
	date_awarded: string;
};

export function getOrCreateMember(name: string) {
	try {
		const conn = getWriteDBConnecton()
		const insertStmt = conn.prepare(`
			INSERT INTO members (name) VALUES (?)
			ON CONFLICT(name) DO NOTHING;
		`);
		insertStmt.run(name);
		const selectStmt = conn.prepare(`SELECT id, name FROM members WHERE name = ?`);
		return selectStmt.get(name) as {name: string, id: number};
	} catch (err) {
		console.error(err);
		throw new Error("Failed to get member");
	}
}

export function getMembersList() {
	return query<{ id: number, name: string }>(`SELECT id, name FROM members`);
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
