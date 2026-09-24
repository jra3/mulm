import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection, withTransaction } from "../db/conn";
import { createMember } from "../db/members";

let db: Database;

const tick = () => new Promise((resolve) => setImmediate(resolve));

void describe("withTransaction", () => {
  beforeEach(async () => {
    db = await open({ filename: ":memory:", driver: sqlite3.Database });
    await db.exec("CREATE TABLE counter (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)");
    await db.run("INSERT INTO counter (id, n) VALUES (1, 0)");
    overrideConnection(db);
  });

  afterEach(async () => {
    await db.close();
  });

  void test("overlapping transactions run one after the other, each seeing the last commit", async () => {
    const increment = () =>
      withTransaction(async (tx) => {
        const row = await tx.get<{ n: number }>("SELECT n FROM counter WHERE id = 1");
        await tick();
        await tx.run("UPDATE counter SET n = ? WHERE id = 1", row!.n + 1);
      });

    await Promise.all([increment(), increment(), increment()]);

    const row = await db.get<{ n: number }>("SELECT n FROM counter WHERE id = 1");
    assert.strictEqual(row!.n, 3);
  });

  void test("a transaction that throws rolls back and lets the next one run", async () => {
    const failing = withTransaction(async (tx) => {
      await tx.run("UPDATE counter SET n = 99 WHERE id = 1");
      await tick();
      throw new Error("boom");
    });
    const next = withTransaction(async (tx) => {
      await tx.run("UPDATE counter SET n = n + 1 WHERE id = 1");
    });

    await assert.rejects(failing, /boom/);
    await next;

    const row = await db.get<{ n: number }>("SELECT n FROM counter WHERE id = 1");
    assert.strictEqual(row!.n, 1);
  });

  void test("a transaction opened inside another is refused, not left waiting on itself", async () => {
    await assert.rejects(
      withTransaction(() => withTransaction(async () => undefined)),
      /inside another/
    );

    // The lock was released: the next transaction still runs.
    await withTransaction(async (tx) => {
      await tx.run("UPDATE counter SET n = 7 WHERE id = 1");
    });
    const row = await db.get<{ n: number }>("SELECT n FROM counter WHERE id = 1");
    assert.strictEqual(row!.n, 7);
  });
});

void describe("createMember", () => {
  beforeEach(async () => {
    db = await open({ filename: ":memory:", driver: sqlite3.Database });
    await db.exec("PRAGMA foreign_keys = ON;");
    await db.migrate({ migrationsPath: "./db/migrations" });
    overrideConnection(db);
  });

  afterEach(async () => {
    await db.close();
  });

  void test("runs alongside another transaction without colliding", async () => {
    const [memberId] = await Promise.all([
      createMember("a@example.com", "A", { password: "correct horse battery staple" }),
      withTransaction(async (tx) => {
        await tick();
        await tx.run("INSERT INTO members (display_name, contact_email) VALUES ('B', 'b@example.com')");
      }),
    ]);

    const count = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM members");
    assert.strictEqual(count!.n, 2);
    const password = await db.get("SELECT 1 FROM password_account WHERE member_id = ?", memberId);
    assert.ok(password, "the password row committed with the member");
  });
});
