import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import config from '../config.json';
import { logger } from '@/utils/logger';
import { queryMetrics, normalizeQuery } from '@/utils/query-metrics';

export let readOnlyConn: Database;
export let writeConn: Database;

export function db(write = false) {
	if (write) {
		return writeConn;
	} else {
		return readOnlyConn;
	}
}

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

	// Add performance monitoring (when enabled)
	// TODO: Re-enable when performance monitoring is stable
	// if (config.monitoring.enabled) {
	//	readOnlyConn = withDatabaseMonitoring(readOnlyConn, 'read');
	//	writeConn = withDatabaseMonitoring(writeConn, 'write');
	// }
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
	await adminConn.close();
	await init();
})().catch((error) => {
	logger.error('Failed to initialize database', error);
});

/**
 * Used only in testing to create and use in-memory databases
 */
export function overrideConnection(conn: typeof readOnlyConn) {
	readOnlyConn = conn;
	writeConn = conn;
}

type PartialRow = Record<string, string | number | boolean | null>;

export async function insertOne(table: string, row: PartialRow) {
	const sql = `INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.keys(row).map(() => '?').join(', ')})`;
	const startTime = process.hrtime.bigint();
	let error: string | undefined;

	try {
		const stmt = await writeConn.prepare(sql);
		await stmt.run(...Object.values(row));
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
		throw new Error(`SQLite insert query failed: ${(err as Error).message}`);
	} finally {
		if (config.monitoring.enabled) {
			const endTime = process.hrtime.bigint();
			const executionTime = Number(endTime - startTime) / 1_000_000;

			queryMetrics.recordQuery({
				timestamp: Date.now(),
				query: sql,
				normalizedQuery: normalizeQuery(sql),
				executionTime,
				connectionType: 'write',
				error
			});
		}
	}
}

export async function updateOne(table: string, key: PartialRow, fields: PartialRow) {
	const updates = Object.keys(fields).map(key => `${key} = ?`).join(', ');
	const where = Object.keys(key).map(key => `${key} = ?`).join(' AND ');
	const sql = `UPDATE ${table} SET ${updates} WHERE ${where}`;
	const startTime = process.hrtime.bigint();
	let error: string | undefined;

	try {
		const stmt = await writeConn.prepare(sql);
		await stmt.run(...Object.values(fields), ...Object.values(key));
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
		throw new Error(`SQLite update query failed: ${(err as Error).message}`);
	} finally {
		if (config.monitoring.enabled) {
			const endTime = process.hrtime.bigint();
			const executionTime = Number(endTime - startTime) / 1_000_000;

			queryMetrics.recordQuery({
				timestamp: Date.now(),
				query: sql,
				normalizedQuery: normalizeQuery(sql),
				executionTime,
				connectionType: 'write',
				error
			});
		}
	}
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
	const startTime = process.hrtime.bigint();
	let result: T[] | undefined;
	let error: string | undefined;

	try {
		const db = readOnlyConn;
		const stmt = await db.prepare(sql);
		result = await stmt.all(...params);
		return result!;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
		throw new Error(`SQLite query failed: ${(err as Error).message}`);
	} finally {
		if (config.monitoring.enabled) {
			const endTime = process.hrtime.bigint();
			const executionTime = Number(endTime - startTime) / 1_000_000;

			queryMetrics.recordQuery({
				timestamp: Date.now(),
				query: sql,
				normalizedQuery: normalizeQuery(sql),
				executionTime,
				resultCount: result?.length,
				connectionType: 'read',
				error
			});
		}
	}
}

export async function deleteOne(table: string, key: PartialRow) {
	const where = Object.keys(key).map(key => `${key} = ?`).join(' AND ');
	const sql = `DELETE FROM ${table} WHERE ${where}`;
	const startTime = process.hrtime.bigint();
	let error: string | undefined;

	try {
		const deleteRow = await writeConn.prepare(sql);
		const result = await deleteRow.run(...Object.values(key));
		return result;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
		throw new Error(`SQLite delete failed: ${(err as Error).message}`);
	} finally {
		if (config.monitoring.enabled) {
			const endTime = process.hrtime.bigint();
			const executionTime = Number(endTime - startTime) / 1_000_000;

			queryMetrics.recordQuery({
				timestamp: Date.now(),
				query: sql,
				normalizedQuery: normalizeQuery(sql),
				executionTime,
				connectionType: 'write',
				error
			});
		}
	}
}
