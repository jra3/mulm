import { AuthCode } from "@/auth";
import { writeConn, query, insertOne, deleteOne } from "./conn";

const tableName = "auth_codes";

export async function createAuthCode(codeEntry: AuthCode) {
	return insertOne(
		tableName,
		{ ...codeEntry, expires_on: codeEntry.expires_on.toISOString() },
	)
}

export async function getAuthCode(code: string) {
	const codes = await query<AuthCode>(`SELECT * FROM ${tableName} WHERE code = ?`, [code]);
	return codes.pop();
}

export async function deleteAuthCode(code: string) {
	return deleteOne(tableName, { code });
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
