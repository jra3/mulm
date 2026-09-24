import { AsyncLocalStorage } from "node:async_hooks";
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
 * The tail of the queue of transactions waiting for the write connection.
 *
 * Every transaction shares the one write connection, and SQLite refuses a
 * second BEGIN on a connection while one is open. Queueing them means two
 * requests racing for the same row run one after the other: the second reads
 * what the first committed and is refused by the rules, not by the driver.
 * Plain writes on `writeConn` do not queue; see src/db/README.md.
 */
let transactionQueue: Promise<unknown> = Promise.resolve();

/**
 * Marks the async context of a transaction's callback, so a nested call fails
 * instead of waiting on itself. `active` goes false at commit or rollback: work
 * the callback started without awaiting may still run later, and is free then
 * to open a transaction of its own.
 */
const transactionContext = new AsyncLocalStorage<{ active: boolean }>();

/**
 * Execute a function within a database transaction, after any transaction
 * already running or waiting has finished.
 * The try/catch around ROLLBACK is intentional - it's the standard pattern
 * for the sqlite3 package which doesn't expose transaction state checking.
 * @throws Error if called from inside another transaction's callback
 */
export async function withTransaction<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  if (transactionContext.getStore()?.active) {
    throw new Error("withTransaction cannot be called inside another transaction");
  }
  const run = transactionQueue.then(async () => {
    const context = { active: true };
    try {
      return await transactionContext.run(context, () => runTransaction(fn));
    } finally {
      context.active = false;
    }
  });
  transactionQueue = run.catch(() => undefined);
  return run;
}

async function runTransaction<T>(fn: (db: Database) => Promise<T>): Promise<T> {
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
