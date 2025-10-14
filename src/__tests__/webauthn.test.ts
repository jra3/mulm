import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import {
  saveCredential,
  getCredentialById,
  getCredentialsByMember,
  updateCredentialCounter,
  updateCredentialDeviceName,
  deleteCredential,
  saveChallenge,
  getChallenge,
  deleteExpiredChallenges,
} from "../db/webauthn";

describe("WebAuthn Database Operations", () => {
  let db: Database;
  let testMemberId: number;

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

    // Create test member
    const memberResult = await db.run(`
      INSERT INTO members (display_name, contact_email)
      VALUES ('Test User', 'test@example.com')
    `);
    testMemberId = memberResult.lastID as number;
  });

  afterEach(async () => {
    await db.close();
  });

  describe("Credential Management", () => {
    test("should save and retrieve credential", async () => {
      const credentialId = await saveCredential({
        member_id: testMemberId,
        credential_id: "test-credential-123",
        public_key: Buffer.from("fake-public-key"),
        counter: 0,
        transports: '["internal"]',
        device_name: "iPhone",
      });

      assert.ok(credentialId > 0);

      const retrieved = await getCredentialById("test-credential-123");
      assert.ok(retrieved);
      assert.strictEqual(retrieved.member_id, testMemberId);
      assert.strictEqual(retrieved.credential_id, "test-credential-123");
      assert.strictEqual(retrieved.counter, 0);
      assert.strictEqual(retrieved.device_name, "iPhone");
    });

    test("should get all credentials for a member", async () => {
      await saveCredential({
        member_id: testMemberId,
        credential_id: "cred-1",
        public_key: Buffer.from("key-1"),
        counter: 0,
      });

      await saveCredential({
        member_id: testMemberId,
        credential_id: "cred-2",
        public_key: Buffer.from("key-2"),
        counter: 5,
        device_name: "YubiKey",
      });

      const credentials = await getCredentialsByMember(testMemberId);
      assert.strictEqual(credentials.length, 2);
      assert.ok(credentials.some((c) => c.credential_id === "cred-1"));
      assert.ok(credentials.some((c) => c.credential_id === "cred-2"));
    });

    test("should update credential counter", async () => {
      await saveCredential({
        member_id: testMemberId,
        credential_id: "test-cred",
        public_key: Buffer.from("key"),
        counter: 0,
      });

      await updateCredentialCounter("test-cred", 5);

      const updated = await getCredentialById("test-cred");
      assert.ok(updated);
      assert.strictEqual(updated.counter, 5);
      assert.ok(updated.last_used_on); // Should be set
    });

    test("should update device name", async () => {
      const credId = await saveCredential({
        member_id: testMemberId,
        credential_id: "test-cred",
        public_key: Buffer.from("key"),
        counter: 0,
      });

      await updateCredentialDeviceName(credId, "My MacBook");

      const updated = await getCredentialById("test-cred");
      assert.ok(updated);
      assert.strictEqual(updated.device_name, "My MacBook");
    });

    test("should delete credential", async () => {
      const credId = await saveCredential({
        member_id: testMemberId,
        credential_id: "test-cred",
        public_key: Buffer.from("key"),
        counter: 0,
      });

      await deleteCredential(credId);

      const deleted = await getCredentialById("test-cred");
      assert.strictEqual(deleted, null);
    });

    test("should cascade delete credentials when member deleted", async () => {
      // Enable FK constraints in test
      await db.run("PRAGMA foreign_keys = ON");

      await saveCredential({
        member_id: testMemberId,
        credential_id: "test-cred",
        public_key: Buffer.from("key"),
        counter: 0,
      });

      // Delete member
      await db.run("DELETE FROM members WHERE id = ?", [testMemberId]);

      // Credential should be gone (cascaded)
      const credential = await getCredentialById("test-cred");
      assert.strictEqual(credential, null);
    });
  });

  describe("Challenge Management", () => {
    test("should save and retrieve registration challenge", async () => {
      await saveChallenge("test-challenge-123", "registration", testMemberId);

      const retrieved = await getChallenge("test-challenge-123");
      assert.ok(retrieved);
      assert.strictEqual(retrieved.challenge, "test-challenge-123");
      assert.strictEqual(retrieved.member_id, testMemberId);
      assert.strictEqual(retrieved.purpose, "registration");
    });

    test("should save authentication challenge without member_id", async () => {
      await saveChallenge("auth-challenge", "authentication");

      const retrieved = await getChallenge("auth-challenge");
      assert.ok(retrieved);
      assert.strictEqual(retrieved.member_id, null);
      assert.strictEqual(retrieved.purpose, "authentication");
    });

    test("should be single-use (deleted after retrieval)", async () => {
      await saveChallenge("one-time", "registration", testMemberId);

      const first = await getChallenge("one-time");
      assert.ok(first);

      const second = await getChallenge("one-time");
      assert.strictEqual(second, null, "Challenge should be deleted after first use");
    });

    test("should not retrieve expired challenges", async () => {
      // Manually insert expired challenge
      await db.run(`
        INSERT INTO webauthn_challenges (challenge, purpose, expires_on)
        VALUES ('expired', 'registration', datetime('now', '-10 minutes'))
      `);

      const expired = await getChallenge("expired");
      assert.strictEqual(expired, null);
    });

    test("should delete expired challenges", async () => {
      // Create expired challenge
      await db.run(`
        INSERT INTO webauthn_challenges (challenge, purpose, expires_on)
        VALUES ('old-challenge', 'registration', datetime('now', '-1 hour'))
      `);

      // Create valid challenge
      await saveChallenge("valid-challenge", "registration", testMemberId);

      const deletedCount = await deleteExpiredChallenges();
      assert.strictEqual(deletedCount, 1);

      // Valid challenge should still exist
      const valid = await getChallenge("valid-challenge");
      assert.ok(valid);
    });
  });
});
