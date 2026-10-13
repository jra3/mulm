import { createTestDatabase } from "../database";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import config from "../../../config.json";
import { db, ensureReady, overrideConnection, readOnlyConn, writeConn } from "../../../db/conn";
import * as catalogue from "../../../species";
import * as fixtures from "../fixtures";
import { opened, closed, migrations } from "./preload";

async function main() {
  // Referencing imported values prevents transpilers from discarding imports.
  assert.ok(catalogue.findSpeciesById);
  assert.ok(fixtures.createTestMember);
  await setTimeout(30);
  assert.equal(opened.length, 0, "imports must never open a database");
  assert.equal(existsSync(config.database.file), false);
  assert.throws(() => db(), /await ensureReady/);

  const scenario = process.env.DB_SCENARIO;
  if (scenario === "imports") return;
  if (scenario === "override") {
    const fixture = await createTestDatabase({ foreignKeys: "off", migrations: "latest" });
    overrideConnection(fixture.db);
    const opensBeforeReady = opened.length;
    await Promise.all([ensureReady(), ensureReady()]);
    assert.equal(db(), fixture.db);
    assert.equal(db(true), fixture.db);
    assert.equal(opened.length, opensBeforeReady);
    assert.equal(existsSync(config.database.file), false);
    await fixture.cleanup();
    return;
  }
  if (scenario === "read-only" || scenario === "read-only-missing") {
    if (scenario === "read-only") {
      const seed = await open({ filename: config.database.file, driver: sqlite3.Database });
      await seed.exec("CREATE TABLE example (value TEXT)");
      await seed.close();
    }
    const result = ensureReady({ readOnly: true });
    if (scenario === "read-only-missing") {
      await assert.rejects(result, /SQLITE_CANTOPEN/);
      assert.equal(existsSync(config.database.file), false);
      assert.equal(ensureReady({ readOnly: true }), result);
      await assert.rejects(ensureReady({ readOnly: true }), /SQLITE_CANTOPEN/);
      return;
    }
    await result;
    assert.equal(migrations, 0);
    assert.deepEqual(await db().all("SELECT * FROM example"), []);
    await assert.rejects(db(true).run("INSERT INTO example VALUES ('no')"), /SQLITE_READONLY/);
    await assert.rejects(ensureReady(), /mode cannot change/);
    await db().close();
    return;
  }

  const first = ensureReady();
  assert.equal(first, ensureReady(), "concurrent callers share the exact promise");
  assert.equal(readOnlyConn, undefined);
  assert.equal(writeConn, undefined);
  if (scenario === "migration-failure" || scenario === "write-open-failure") {
    await assert.rejects(first, /SQLITE_/);
    assert.equal(ensureReady(), first, "failure is terminal and memoized");
    await assert.rejects(ensureReady(), /SQLITE_/);
    assert.equal(readOnlyConn, undefined);
    assert.equal(writeConn, undefined);
    assert.equal(opened.length, scenario === "migration-failure" ? 1 : 3);
    assert.equal(closed.length, scenario === "migration-failure" ? 1 : 2);
    for (const connection of opened.slice(0, closed.length)) assert.ok(closed.includes(connection));
    for (const connection of opened.slice(0, scenario === "migration-failure" ? 1 : 2)) {
      await assert.rejects(connection.get("SELECT 1"), /closed/);
    }
    return;
  }
  assert.throws(() => overrideConnection(opened[0]), /before calling ensureReady/);
  await Promise.all([first, ensureReady(), ensureReady()]);
  assert.equal(opened.length, 3);
  assert.equal(migrations, 1);
  assert.equal(closed.length, 1, "administrative connection is closed");
  assert.equal(ensureReady(), first);
  assert.ok(await db().get("SELECT COUNT(*) AS count FROM members"));
  await db(true).run(
    "INSERT INTO members (display_name, contact_email) VALUES ('Ready', 'ready@example.test')"
  );
  assert.equal((await db().get("SELECT display_name FROM members"))?.display_name, "Ready");
  await db().close();
  await db(true).close();
}

void main().then(
  () => {
    console.log("DB_SCENARIO_COMPLETE");
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  }
);
