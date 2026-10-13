// Loaded before the executable's static imports in an isolated child process.
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { Database } from "sqlite";
import config from "../../../config.json";

assert.ok(process.env.TEST_DATABASE_FILE);
config.database.file = process.env.TEST_DATABASE_FILE;
export const opened: Database[] = [];
export const closed: Database[] = [];
export let migrations = 0;
// The originals are explicitly invoked with the intercepted Database as `this`.
/* eslint-disable @typescript-eslint/unbound-method */
const originalOpen = Database.prototype.open;
const originalMigrate = Database.prototype.migrate;
const originalClose = Database.prototype.close;
/* eslint-enable @typescript-eslint/unbound-method */
mock.method(Database.prototype, "open", async function (this: Database) {
  opened.push(this);
  if (
    (process.env.DB_SCENARIO === "write-open-failure" && opened.length === 3) ||
    (process.env.DB_SCENARIO === "admin-open-failure" && opened.length === 1)
  ) {
    this.config.filename += "/missing/child.sqlite";
  }
  await originalOpen.call(this);
});
mock.method(
  Database.prototype,
  "migrate",
  async function (this: Database, ...args: Parameters<Database["migrate"]>) {
    migrations++;
    if (process.env.DB_SCENARIO === "migration-failure") {
      await this.exec("THIS IS INVALID SQL");
    }
    return originalMigrate.apply(this, args);
  }
);
mock.method(Database.prototype, "close", async function (this: Database) {
  closed.push(this);
  return originalClose.call(this);
});

process.on("exit", () => {
  writeFileSync(
    `${config.database.file}.observed.json`,
    JSON.stringify({ opens: opened.length, migrations })
  );
});
