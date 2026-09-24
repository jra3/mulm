/**
 * An email address is the same address whatever its case. Members are found by
 * email at login, password reset, signup and on a first Google or Facebook
 * login; a case mismatch there used to miss the member, and the OAuth paths
 * then created a second account for them.
 */
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import fs from "fs";
import { overrideConnection } from "../db/conn";
import { createMember, getMemberByEmail } from "../db/members";
import { migrationsUpTo } from "./helpers/migrations";

void describe("member email", () => {
  let db: Database;

  beforeEach(async () => {
    db = await open({ filename: ":memory:", driver: sqlite3.Database });
    await db.exec("PRAGMA foreign_keys = ON;");
    await db.migrate({ migrationsPath: "./db/migrations" });
    overrideConnection(db);
  });

  afterEach(async () => {
    await db.close();
  });

  void test("finds the member whatever the case of the address", async () => {
    const id = await createMember("Jane.Doe@Example.com", "Jane");
    assert.strictEqual((await getMemberByEmail("jane.doe@example.com"))?.id, id);
    assert.strictEqual((await getMemberByEmail("JANE.DOE@EXAMPLE.COM"))?.id, id);
    assert.strictEqual((await getMemberByEmail("  jane.doe@example.com "))?.id, id);
  });

  void test("keeps the address as the member typed it", async () => {
    await createMember("Jane.Doe@Example.com", "Jane");
    assert.strictEqual((await getMemberByEmail("jane.doe@example.com"))?.contact_email, "Jane.Doe@Example.com");
  });

  void test("refuses a second member with a case variant of an address", async () => {
    await createMember("Jane.Doe@Example.com", "Jane");
    await assert.rejects(() => createMember("jane.doe@example.com", "Jane again"));
    const count = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM members");
    assert.strictEqual(count!.n, 1);
  });
});

void describe("migration 061", () => {
  void test("refuses to run while two members share an address up to case", async () => {
    const before061 = migrationsUpTo(60);
    const raw = await open({ filename: ":memory:", driver: sqlite3.Database });
    try {
      await raw.migrate({ migrationsPath: before061 });
      await raw.run("INSERT INTO members (display_name, contact_email) VALUES ('A', 'Jane@example.com')");
      await raw.run("INSERT INTO members (display_name, contact_email) VALUES ('B', 'jane@example.com')");

      await assert.rejects(
        () => raw.migrate({ migrationsPath: "./db/migrations" }),
        /UNIQUE constraint failed/
      );
      const applied = await raw.get<{ id: number }>("SELECT MAX(id) AS id FROM migrations");
      assert.strictEqual(applied!.id, 60, "061 is not recorded as applied");
    } finally {
      await raw.close();
      fs.rmSync(before061, { recursive: true, force: true });
    }
  });
});
