import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import { runDailyCleanup } from "@/scheduled/cleanup";
import { createAuthCode } from "@/db/auth";
import { query } from "@/db/conn";

void describe("Scheduled Cleanup Tasks", () => {
  let db: Database;

  beforeEach(async () => {
    // Create in-memory database
    db = await open({
      filename: ":memory:",
      driver: sqlite3.Database,
    });

    // Run all migrations
    await db.migrate({
      migrationsPath: "./db/migrations",
    });

    // Override connection for testing
    overrideConnection(db);
  });

  afterEach(async () => {
    await db.close();
  });

  void test("should delete expired auth codes", async () => {
    // Create test member
    const memberResult = await db.run(`
      INSERT INTO members (display_name, contact_email)
      VALUES ('Test User', 'test@example.com')
    `);
    const memberId = memberResult.lastID as number;

    // Create an expired auth code (expires in the past)
    const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
    await createAuthCode({
      code: "expired-test-code",
      member_id: memberId,
      purpose: "password_reset",
      expires_on: expiredDate,
    });

    // Create a valid auth code (expires in the future)
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day from now
    await createAuthCode({
      code: "valid-test-code",
      member_id: memberId,
      purpose: "password_reset",
      expires_on: futureDate,
    });

    // Run cleanup
    await runDailyCleanup();

    // Verify expired code was deleted
    const authCodes = await query<{ code: string }>(
      "SELECT code FROM auth_codes WHERE code IN (?, ?)",
      ["expired-test-code", "valid-test-code"]
    );

    assert.strictEqual(authCodes.length, 1);
    assert.strictEqual(authCodes[0]?.code, "valid-test-code");
  });

  void test("should handle cleanup when no expired data exists", async () => {
    // Clear all data
    await query("DELETE FROM auth_codes", []);

    // Run cleanup (should not throw)
    await runDailyCleanup();

    // Verify no errors occurred (test passes if no exception thrown)
    assert.ok(true);
  });
});
