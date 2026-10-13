import { rmSync } from "node:fs";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../../db/conn";
import { allMigrations, migrationsUpTo } from "./migrations";

export interface TestDatabase {
  db: Database;
  cleanup: () => Promise<void>;
  /** Run forward or backward to a historical migration, or to the latest schema. */
  migrate: (lastId?: number | "latest") => Promise<void>;
}

export interface TestDatabaseOptions {
  foreignKeys: "on" | "off";
  /** false leaves an empty database for tests with intentionally hand-written schemas. */
  migrations: "latest" | number | false;
  /** Historical/raw databases can opt out of replacing the process-wide connection. */
  installConnection?: boolean;
}

/**
 * Owns one disposable in-memory connection, with no application fixtures.
 * Suites using the process-wide override must run serially within a process.
 * Importing this module never opens the configured on-disk database.
 */
export async function createTestDatabase(options: TestDatabaseOptions): Promise<TestDatabase> {
  const db = await open({ filename: ":memory:", driver: sqlite3.Database });
  let closed = false;
  const cleanup = async () => {
    if (closed) return;
    await db.close();
    closed = true;
  };
  const migrate = async (lastId: number | "latest" = "latest") => {
    const directory = lastId === "latest" ? allMigrations : migrationsUpTo(lastId);
    try {
      await db.migrate({ migrationsPath: directory });
    } finally {
      if (lastId !== "latest") rmSync(directory, { recursive: true, force: true });
    }
  };
  try {
    await db.exec(`PRAGMA foreign_keys = ${options.foreignKeys.toUpperCase()};`);
    if (options.migrations !== false) await migrate(options.migrations);
    if (options.installConnection !== false) overrideConnection(db);
    return { db, cleanup, migrate };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Test database setup and cleanup failed", {
        cause: cleanupError,
      });
    }
    throw error;
  }
}
