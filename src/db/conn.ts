import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

export let readOnlyConn: Database;
export let writeConn: Database;

(async () => {
	readOnlyConn = await open({
		filename: './database.sqlite',
		driver: sqlite3.Database,
		mode: sqlite3.OPEN_READONLY,
	});

	writeConn = await open({
		filename: './database.sqlite',
		driver: sqlite3.Database,
		mode: sqlite3.OPEN_READWRITE,
	});
})();


/**
 * Used only in testing to create and use in-memory databases
 */
export function overrideConnection(conn: typeof readOnlyConn) {
	readOnlyConn = conn;
	writeConn = conn;
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
