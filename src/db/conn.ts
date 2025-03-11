import Database from 'better-sqlite3';

function getDBConnecton(readonly: boolean) {
    return new Database('./database.sqlite', { readonly});
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
