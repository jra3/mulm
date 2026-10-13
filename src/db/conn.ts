import { AsyncLocalStorage } from "node:async_hooks";
import sqlite3 from "sqlite3";
import { Database } from "sqlite";
import config from "../config.json";
import { logger } from "@/utils/logger";

export let readOnlyConn: Database;
export let writeConn: Database;

/** Initialization is explicit and terminal: a failed bootstrap requires a restart. */
let readiness: Promise<void> | undefined;
let connectionMode: "read-write" | "read-only" | "test" | undefined;

export function db(write = false) {
  const connection = write ? writeConn : readOnlyConn;
  if (!connection) {
    throw new Error("Database is not initialized; await ensureReady() before using it");
  }
  return connection;
}

/**
 * Open the configured database once. Imports perform no database I/O.
 *
 * Read-only mode is for reporting/dry-run executables: it requires an existing
 * database and never creates, migrates, or opens a writable connection. A
 * process cannot promote a read-only initialization to read-write later.
 * Failures are memoized along with successes, including concurrent callers.
 */
export function ensureReady(options: { readOnly?: boolean } = {}): Promise<void> {
  if (connectionMode === "test") return readiness!;
  const mode = options.readOnly ? "read-only" : "read-write";
  if (connectionMode && connectionMode !== mode) {
    return Promise.reject(new Error("Database initialization mode cannot change within a process"));
  }
  if (!readiness) {
    connectionMode = mode;
    readiness = initializeConnections(options.readOnly ?? false);
  }
  return readiness;
}

async function initializeConnections(readOnly: boolean): Promise<void> {
  const connections = new Set<Database>();
  const openConnection = async (mode: number) => {
    const connection = new Database({
      filename: config.database.file,
      driver: sqlite3.Database,
      mode,
    });
    await connection.open();
    // sqlite3 closes its native handle on open failure. Calling close() on
    // that failed wrapper can wait forever, so track only successful opens.
    connections.add(connection);
    return connection;
  };
  try {
    if (!readOnly) {
      const admin = await openConnection(sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE);
      await admin.migrate({ migrationsPath: "./db/migrations" });
      await admin.close();
      connections.delete(admin);
    }
    const reader = await openConnection(sqlite3.OPEN_READONLY);
    const writer = readOnly ? reader : await openConnection(sqlite3.OPEN_READWRITE);
    // Publish together only after every connection is usable.
    readOnlyConn = reader;
    writeConn = writer;
  } catch (error) {
    await Promise.allSettled([...connections].map(async (connection) => connection.close()));
    throw error;
  }
}

/**
 * Install a test-owned connection before any configured-file initialization.
 * Repeated fixture installations are allowed; the fixture owns their cleanup.
 */
export function overrideConnection(conn: typeof readOnlyConn) {
  if (connectionMode && connectionMode !== "test") {
    throw new Error("Install the test connection before calling ensureReady()");
  }
  connectionMode = "test";
  readOnlyConn = conn;
  writeConn = conn;
  readiness ??= Promise.resolve();
}

/** Terminal process teardown. Test overrides remain owned by their fixture. */
export async function closeConnections(): Promise<void> {
  if (connectionMode === "test") return;
  const connections = new Set([readOnlyConn, writeConn].filter(Boolean));
  const results = await Promise.allSettled(
    [...connections].map((connection) => connection.close())
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length)
    throw new AggregateError(
      failures.map((result): unknown => result.reason),
      "Database teardown failed"
    );
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
  | "apple_account"
  | "tank_presets";

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
    throw new Error(`SQLite insert query failed: ${(error as Error).message}`, { cause: error });
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
    throw new Error(`SQLite update query failed: ${(error as Error).message}`, { cause: error });
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
    throw new Error(`SQLite query failed: ${(error as Error).message}`, { cause: error });
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
    throw new Error(`SQLite delete failed: ${(error as Error).message}`, { cause: error });
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
 * How long a transaction may hold the write connection before it is logged.
 * Every other write waits behind it, so one that never finishes stalls the
 * app; a timeout could not free the connection (its BEGIN is still open), but
 * the log says which one to look at.
 */
export const TRANSACTION_SLOW_MS = 5000;

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
    const started = Date.now();
    let slow = false;
    const watch = setTimeout(() => {
      slow = true;
      logger.warn("Transaction still holding the write connection; other writes are waiting", {
        heldMs: Date.now() - started,
        callback: fn.name || "(anonymous)",
      });
    }, TRANSACTION_SLOW_MS);
    watch.unref();
    try {
      return await transactionContext.run(context, () => runTransaction(fn));
    } finally {
      context.active = false;
      clearTimeout(watch);
      if (slow) {
        logger.warn("Slow transaction released the write connection", {
          heldMs: Date.now() - started,
        });
      }
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
