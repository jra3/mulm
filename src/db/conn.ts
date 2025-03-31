import Database from 'better-sqlite3';

let dbFactory = (readonly: boolean) => {
	return new Database('./database.sqlite', { readonly});
}
/**
 * Used only in testing to create and use in-memory databases
 */
export function setDBFactory(factory: typeof dbFactory) {
  dbFactory = factory;
}

export function getDBConnecton(readonly: boolean) {
	return dbFactory(readonly);
}

export const getReadDBConnecton = () => getDBConnecton(true);
export const getWriteDBConnecton = () => getDBConnecton(false);

export function query<T>(sql: string, params: unknown[] = []): T[] {
	try {
		const db = getReadDBConnecton();
		const stmt = db.prepare(sql);
		const rows: T[] = stmt.all(...params) as T[];
		db.close();
		return rows;
	} catch (error) {
		throw new Error(`SQLite query failed: ${(error as Error).message}`);
	}
}
