import { AuthCode } from "@/auth";
import { writeConn, query } from "./conn";

export async function createAuthCode(codeEntry: AuthCode) {
	const db = writeConn;
	try {
		const stmt = await db.prepare(`
			INSERT INTO auth_codes
			(code, member_id, purpose, expires_on)
			VALUES (?, ?, ?, ?)
		`);
		const { code, member_id, purpose, expires_on } = codeEntry;
		await stmt.run(code, member_id, purpose, expires_on.toISOString());
	} catch (err) {
		console.error(err);
		throw new Error("Failed to insert code");
	}
}

export async function getAuthCode(code: string) {
	const codes = await query<AuthCode>(`SELECT * FROM auth_codes WHERE code = ?`, [code]);
	return codes.pop();
}

export async function deleteAuthCode(code: string) {
	try {
		const conn = writeConn;
		const deleteRow = await conn.prepare("DELETE FROM auth_codes WHERE code = ?");
		return deleteRow.run(code);
	} catch (err) {
		console.error(err);
		throw new Error("Failed to delete auth code");
	}
}

export async function deleteExpiredAuthCodes(cutoff: Date) {
	try {
		const conn = writeConn;
		const deleteRow = await conn.prepare("DELETE FROM auth_codes WHERE expires_on < ?");
		return deleteRow.run(cutoff);
	} catch (err) {
		console.error(err);
		throw new Error("Failed to delete auth codes");
	}
}
