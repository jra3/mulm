import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import config from '../config.json';

export let readOnlyConn: Database;
export let writeConn: Database;

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
