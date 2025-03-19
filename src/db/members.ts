import { getWriteDBConnecton } from "./conn";

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

console.log(getOrCreateMember("John Allen"));
console.log(getOrCreateMember("John Allen"));
console.log(getOrCreateMember("John Allen"));
console.log(getOrCreateMember("David Manuel"));
