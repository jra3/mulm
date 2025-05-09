import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import config from '../config.json';

export let readOnlyConn: Database;
export let writeConn: Database;

export async function init() {
	readOnlyConn = await open({
		filename: config.databaseFile,
		driver: sqlite3.Database,
		mode: sqlite3.OPEN_READONLY,
	});

	writeConn = await open({
		filename: config.databaseFile,
		driver: sqlite3.Database,
		mode: sqlite3.OPEN_READWRITE,
	});
}

(async () => {
	const adminConn = await open({
		filename: config.databaseFile,
		driver: sqlite3.Database,
		mode: sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE,
	});
	await adminConn.migrate({
    migrationsPath: './db/migrations',
	});
	adminConn.close();
	await init();
})();

/**
 * Used only in testing to create and use in-memory databases
 */
export function overrideConnection(conn: typeof readOnlyConn) {
	readOnlyConn = conn;
	writeConn = conn;
}

type PartialRow = Record<string, string | number | boolean | null>;

export async function insertOne(table: string, row: PartialRow) {
	try {
		const stmt = await writeConn.prepare(`
			INSERT INTO ${table}
			(${Object.keys(row).join(', ')})
			VALUES
			(${Object.keys(row).map(() => '?').join(', ')})`);
		await stmt.run(...Object.values(row));
	} catch (error) {
		throw new Error(`SQLite insert query failed: ${(error as Error).message}`);
	}
}

export async function updateOne(table: string, key: PartialRow, fields: PartialRow) {
	try {
		const updates = Object.keys(fields).map(key => `${key} = ?`).join(', ');
		const where = Object.keys(key).map(key => `${key} = ?`).join(' AND ');
		const stmt = await writeConn.prepare(`UPDATE ${table} SET ${updates} WHERE ${where}`);
		await stmt.run(...Object.values(fields), ...Object.values(key));
	} catch (error) {
		throw new Error(`SQLite update query failed: ${(error as Error).message}`);
	}
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
	try {
		const db = readOnlyConn;
		const stmt = await db.prepare(sql);
		const rows: T[] = await stmt.all(...params) as T[];
		return rows;
	} catch (error) {
		throw new Error(`SQLite query failed: ${(error as Error).message}`);
	}
}

export async function deleteOne(table: string, key: PartialRow) {
	try {
		const where = Object.keys(key).map(key => `${key} = ?`).join(' AND ');
		const deleteRow = await writeConn.prepare(`DELETE FROM ${table} WHERE ${where}`);
		return deleteRow.run(...Object.values(key));
	} catch (error) {
		throw new Error(`SQLite delete failed: ${(error as Error).message}`);
	}
}
