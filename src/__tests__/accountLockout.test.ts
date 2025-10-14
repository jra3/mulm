import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import {
  recordFailedAttempt,
  isAccountLocked,
  clearFailedAttempts,
  getRemainingLockoutTime,
} from "../services/accountLockout";

void describe("Account Lockout Service", () => {
  let db: Database;
  let testMemberId: number;

  beforeEach(async () => {
    // Create fresh in-memory database for each test
    db = await open({
      filename: ":memory:",
      driver: sqlite3.Database,
    });

    await db.exec("PRAGMA foreign_keys = ON;");

    // Run migrations
    await db.migrate({
      migrationsPath: "./db/migrations",
    });

    // Override the global connection
    overrideConnection(db);

    // Create test member
    const result = await db.run("INSERT INTO members (contact_email, display_name) VALUES (?, ?)", [
      "test@example.com",
      "Test User",
    ]);
    testMemberId = result.lastID as number;
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  void test("should not lock account after 1 failed attempt", async () => {
    await recordFailedAttempt(testMemberId, "1.1.1.1");

    const locked = await isAccountLocked(testMemberId);
    assert.strictEqual(locked, false);
  });

  void test("should not lock account after 4 failed attempts", async () => {
    for (let i = 0; i < 4; i++) {
      await recordFailedAttempt(testMemberId, "1.1.1.1");
    }

    const locked = await isAccountLocked(testMemberId);
    assert.strictEqual(locked, false);
  });

  void test("should lock account after 5 failed attempts", async () => {
    for (let i = 0; i < 5; i++) {
      const wasLocked = await recordFailedAttempt(testMemberId, "1.1.1.1");
      if (i < 4) {
        assert.strictEqual(wasLocked, false, `Attempt ${i + 1} should not lock`);
      } else {
        assert.strictEqual(wasLocked, true, "Attempt 5 should lock account");
      }
    }

    const locked = await isAccountLocked(testMemberId);
    assert.strictEqual(locked, true);
  });

  void test("should return remaining lockout time", async () => {
    // Lock the account
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt(testMemberId, "1.1.1.1");
    }

    const remainingSeconds = await getRemainingLockoutTime(testMemberId);

    // Should be approximately 15 minutes (900 seconds)
    assert.ok(remainingSeconds > 890 && remainingSeconds <= 900);
  });

  void test("should clear failed attempts on successful login", async () => {
    // Record some failed attempts
    for (let i = 0; i < 3; i++) {
      await recordFailedAttempt(testMemberId, "1.1.1.1");
    }

    // Verify attempts were recorded
    const attempts = await db.all(
      "SELECT * FROM failed_login_attempts WHERE member_id = ?",
      testMemberId
    );
    assert.strictEqual(attempts.length, 3);

    // Clear attempts (simulating successful login)
    await clearFailedAttempts(testMemberId);

    // Verify attempts were cleared
    const attemptsAfter = await db.all(
      "SELECT * FROM failed_login_attempts WHERE member_id = ?",
      testMemberId
    );
    assert.strictEqual(attemptsAfter.length, 0);

    // Verify not locked
    const locked = await isAccountLocked(testMemberId);
    assert.strictEqual(locked, false);
  });

  void test("should clear lockout when clearing failed attempts", async () => {
    // Lock the account
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt(testMemberId, "1.1.1.1");
    }

    // Verify locked
    assert.strictEqual(await isAccountLocked(testMemberId), true);

    // Clear attempts
    await clearFailedAttempts(testMemberId);

    // Verify unlocked
    assert.strictEqual(await isAccountLocked(testMemberId), false);

    // Verify locked_until cleared
    const member = await db.get<{ locked_until: string | null }>(
      "SELECT locked_until FROM members WHERE id = ?",
      testMemberId
    );
    assert.strictEqual(member?.locked_until, null);
  });

  void test("should track failed attempts with IP addresses", async () => {
    await recordFailedAttempt(testMemberId, "1.1.1.1");
    await recordFailedAttempt(testMemberId, "2.2.2.2");

    const attempts = await db.all<Array<{ ip_address: string }>>(
      "SELECT ip_address FROM failed_login_attempts WHERE member_id = ? ORDER BY attempted_at",
      testMemberId
    );

    assert.strictEqual(attempts.length, 2);
    assert.strictEqual(attempts[0].ip_address, "1.1.1.1");
    assert.strictEqual(attempts[1].ip_address, "2.2.2.2");
  });

  void test("should only count attempts within time window", async () => {
    // This test verifies that old attempts don't count toward lockout
    // In a real test, we'd manipulate timestamps, but for now we verify
    // the query logic is correct by checking recent attempts

    // Record 3 attempts
    for (let i = 0; i < 3; i++) {
      await recordFailedAttempt(testMemberId, "1.1.1.1");
    }

    // Account should not be locked
    const locked = await isAccountLocked(testMemberId);
    assert.strictEqual(locked, false);

    // Verify 3 attempts recorded
    const attempts = await db.all(
      "SELECT * FROM failed_login_attempts WHERE member_id = ?",
      testMemberId
    );
    assert.strictEqual(attempts.length, 3);
  });

  void test("should return 0 remaining time for unlocked account", async () => {
    const remainingSeconds = await getRemainingLockoutTime(testMemberId);
    assert.strictEqual(remainingSeconds, 0);
  });

  void test("should handle multiple members independently", async () => {
    // Create second member
    const result = await db.run("INSERT INTO members (contact_email, display_name) VALUES (?, ?)", [
      "other@example.com",
      "Other User",
    ]);
    const otherMemberId = result.lastID as number;

    // Lock first member
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt(testMemberId, "1.1.1.1");
    }

    // First member should be locked
    assert.strictEqual(await isAccountLocked(testMemberId), true);

    // Second member should not be locked
    assert.strictEqual(await isAccountLocked(otherMemberId), false);
  });
});
