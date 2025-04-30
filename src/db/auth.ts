import { AuthCode } from "@/auth";
import { getWriteDBConnecton, query } from "./conn";

export function createAuthCode(codeEntry: AuthCode) {
	const db = getWriteDBConnecton()
	try {
		const stmt = db.prepare(`
			INSERT INTO auth_codes
			(code, member_id, purpose, expires_on)
			VALUES (?, ?, ?, ?)
		`);
		const { code, member_id, purpose, expires_on } = codeEntry;
		stmt.run(code, member_id, purpose, expires_on.toISOString());
	} catch (err) {
		console.error(err);
		throw new Error("Failed to insert code");
	} finally {
		db.close();
	}
}

export function getAuthCode(code: string) {
	const codes = query<AuthCode>(`SELECT * FROM auth_codes WHERE code = ?`, [code]);
	return codes.pop();
}

export function deleteAuthCode(code: string) {
	try {
		const conn = getWriteDBConnecton();
		const deleteRow = conn.prepare("DELETE FROM auth_codes WHERE code = ?");
		const result = deleteRow.run(code);
		return result;
	} catch (err) {
		console.error(err);
		throw new Error("Failed to delete auth code");
	}
}

export function deleteExpiredAuthCodes(cutoff: Date) {
	try {
		const conn = getWriteDBConnecton();
		const deleteRow = conn.prepare("DELETE FROM auth_codes WHERE expires_on < ?");
		const result = deleteRow.run(cutoff);
		return result;
	} catch (err) {
		console.error(err);
		throw new Error("Failed to delete auth codes");
	}
}
