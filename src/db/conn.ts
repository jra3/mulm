import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import config from "../config.json";
import { logger } from "@/utils/logger";

export let readOnlyConn: Database;
export let writeConn: Database;

/**
 * Whether a test has taken the connections over.
 *
 * Importing this module starts `ready` below, which opens the real database,
 * runs every migration and then calls `init()`. A test that has already called
 * `overrideConnection` is racing that: whichever finishes last wins, and when
 * `ready` wins it silently repoints the module at the real file while the test
 * goes on inspecting its in-memory one.
 *
 * The race is invisible until the migrations are slow enough to land in the
 * middle of a run - a fresh CI checkout with no database file, say - and then
 * it surfaces as an unrelated suite failing on a row that "should have been
 * deleted". So `init()` stands down once a test owns the connections.
 */
let overriddenForTests = false;

export function db(write = false) {
  if (write) {
    return writeConn;
  } else {
    return readOnlyConn;
  }
}

export async function init() {
  if (overriddenForTests) {
    return;
  }

  readOnlyConn = await open({
    filename: config.database.file,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY,
  });

  writeConn = await open({
    filename: config.database.file,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READWRITE,
  });
}

export const ready = (async () => {
  const adminConn = await open({
    filename: config.database.file,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE,
  });
  await adminConn.migrate({
    migrationsPath: "./db/migrations",
  });
  await adminConn.close();
  await init();
})().catch((error) => {
  logger.error("Failed to initialize database", error);
});

/**
 * Used only in testing to create and use in-memory databases.
 *
 * Takes the connections over for good: the bootstrap above will not reclaim
 * them afterwards, however long its migrations take.
 */
export function overrideConnection(conn: typeof readOnlyConn) {
  overriddenForTests = true;
  readOnlyConn = conn;
  writeConn = conn;
}

type PartialRow = Record<string, string | number | boolean | null>;

type TableName =
  | "members"
  | "submissions"
  | "species"
  | "activities"
  | "tanks"
  | "tank_sections"
  | "attachments"
  | "sessions"
  | "auth_codes"
  | "google_account"
  | "facebook_account"
  | "tank_presets"
  | "webauthn_credentials"
  | "webauthn_challenges";

export async function insertOne(table: TableName, row: PartialRow) {
  try {
    const stmt = await writeConn.prepare(`
			INSERT INTO ${table}
			(${Object.keys(row).join(", ")})
			VALUES
			(${Object.keys(row)
        .map(() => "?")
        .join(", ")})`);
    try {
      await stmt.run(...Object.values(row));
    } finally {
      await stmt.finalize();
    }
  } catch (error) {
    throw new Error(`SQLite insert query failed: ${(error as Error).message}`);
  }
}

export async function updateOne(table: TableName, key: PartialRow, fields: PartialRow) {
  try {
    const updates = Object.keys(fields)
      .map((key) => `${key} = ?`)
      .join(", ");
    const where = Object.keys(key)
      .map((key) => `${key} = ?`)
      .join(" AND ");
    const stmt = await writeConn.prepare(`UPDATE ${table} SET ${updates} WHERE ${where}`);
    try {
      await stmt.run(...Object.values(fields), ...Object.values(key));
    } finally {
      await stmt.finalize();
    }
  } catch (error) {
    throw new Error(`SQLite update query failed: ${(error as Error).message}`);
  }
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    const db = readOnlyConn;
    const stmt = await db.prepare(sql);
    try {
      const rows: T[] = await stmt.all(...params);
      return rows;
    } finally {
      await stmt.finalize();
    }
  } catch (error) {
    throw new Error(`SQLite query failed: ${(error as Error).message}`);
  }
}

export async function deleteOne(table: TableName, key: PartialRow) {
  try {
    const where = Object.keys(key)
      .map((key) => `${key} = ?`)
      .join(" AND ");
    const deleteRow = await writeConn.prepare(`DELETE FROM ${table} WHERE ${where}`);
    try {
      return await deleteRow.run(...Object.values(key));
    } finally {
      await deleteRow.finalize();
    }
  } catch (error) {
    throw new Error(`SQLite delete failed: ${(error as Error).message}`);
  }
}

/**
 * Execute a function within a database transaction.
 * The try/catch around ROLLBACK is intentional - it's the standard pattern
 * for the sqlite3 package which doesn't expose transaction state checking.
 */
export async function withTransaction<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  const db = writeConn;
  await db.exec("BEGIN TRANSACTION;");
  try {
    const result = await fn(db);
    await db.exec("COMMIT;");
    return result;
  } catch (err) {
    try {
      await db.exec("ROLLBACK;");
    } catch {
      // Ignore rollback errors - transaction may not be active
      // This is the standard pattern for sqlite3 package
    }
    throw err;
  }
}
