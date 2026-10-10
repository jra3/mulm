import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { setupTestDatabase, type TestDatabase } from "./testDbHelper.helper";
import { checkPassword } from "../auth";
import { createMember, getMemberByEmail, getMemberPassword } from "../db/members";
import { recordFailedAttempt } from "../services/accountLockout";
import { seedStagingUsers, STAGING_ADMIN_EMAIL, STAGING_MEMBER_EMAIL } from "../staging/seedUsers";

const STAGING = { STAGING: "1" };

async function addSession(db: TestDatabase["db"], memberId: number, sessionId: string) {
  await db.run(
    "INSERT INTO sessions (session_id, member_id, expires_on, csrf_token) VALUES (?, ?, ?, ?)",
    [sessionId, memberId, new Date(Date.now() + 86400_000).toISOString(), "csrf"]
  );
}

async function sessionCount(db: TestDatabase["db"], memberId: number) {
  const row = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sessions WHERE member_id = ?",
    memberId
  );
  return row?.n ?? 0;
}

async function passwordWorks(email: string, password: string) {
  const member = await getMemberByEmail(email);
  assert.ok(member, `${email} exists`);
  return checkPassword(await getMemberPassword(member.id), password);
}

void describe("seedStagingUsers", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await setupTestDatabase();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  void test("refuses unless STAGING=1, and changes nothing", async () => {
    for (const env of [{}, { STAGING: "0" }, { STAGING: "true" }]) {
      await assert.rejects(() => seedStagingUsers(env), /STAGING/);
    }
    assert.strictEqual(await getMemberByEmail(STAGING_ADMIN_EMAIL), undefined);
    assert.strictEqual(await getMemberByEmail(STAGING_MEMBER_EMAIL), undefined);
  });

  void test("creates an admin and a member whose passwords log in", async () => {
    const creds = await seedStagingUsers(STAGING);

    assert.strictEqual(creds.admin.email, STAGING_ADMIN_EMAIL);
    assert.strictEqual(creds.member.email, STAGING_MEMBER_EMAIL);
    assert.notStrictEqual(creds.admin.password, creds.member.password);
    assert.ok(creds.admin.password.length >= 24);

    assert.strictEqual((await getMemberByEmail(STAGING_ADMIN_EMAIL))?.is_admin, 1);
    assert.strictEqual((await getMemberByEmail(STAGING_MEMBER_EMAIL))?.is_admin, 0);
    assert.ok(await passwordWorks(STAGING_ADMIN_EMAIL, creds.admin.password));
    assert.ok(await passwordWorks(STAGING_MEMBER_EMAIL, creds.member.password));
  });

  void test("a second run rotates both passwords; the old ones stop working", async () => {
    const first = await seedStagingUsers(STAGING);
    const second = await seedStagingUsers(STAGING);

    assert.notStrictEqual(first.admin.password, second.admin.password);
    assert.notStrictEqual(first.member.password, second.member.password);
    assert.ok(!(await passwordWorks(STAGING_ADMIN_EMAIL, first.admin.password)));
    assert.ok(!(await passwordWorks(STAGING_MEMBER_EMAIL, first.member.password)));
    assert.ok(await passwordWorks(STAGING_ADMIN_EMAIL, second.admin.password));
    assert.ok(await passwordWorks(STAGING_MEMBER_EMAIL, second.member.password));
  });

  void test("takes over existing accounts: restores admin, clears lockouts and sessions", async () => {
    // As restored from prod with the committed E2E password, demoted and locked out.
    const adminId = await createMember(STAGING_ADMIN_EMAIL, "Old Admin", {
      password: "committed-password",
    });
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt(adminId, "1.2.3.4");
    }
    await addSession(testDb.db, adminId, "old-admin-session");

    await seedStagingUsers(STAGING);

    const admin = await testDb.db.get<{ is_admin: number; locked_until: string | null }>(
      "SELECT is_admin, locked_until FROM members WHERE id = ?",
      adminId
    );
    assert.strictEqual(admin?.is_admin, 1);
    assert.strictEqual(admin?.locked_until, null);
    const attempts = await testDb.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM failed_login_attempts WHERE member_id = ?",
      adminId
    );
    assert.strictEqual(attempts?.n, 0);
    assert.strictEqual(await sessionCount(testDb.db, adminId), 0);
    assert.ok(!(await passwordWorks(STAGING_ADMIN_EMAIL, "committed-password")));
  });

  void test("touches no other account", async () => {
    const otherId = await createMember("real.member@example.com", "Real Member", {
      password: "their-password",
    });
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt(otherId, "1.2.3.4");
    }
    await addSession(testDb.db, otherId, "real-session");
    const before = await testDb.db.get("SELECT * FROM members WHERE id = ?", otherId);

    await seedStagingUsers(STAGING);

    assert.deepStrictEqual(
      await testDb.db.get("SELECT * FROM members WHERE id = ?", otherId),
      before
    );
    assert.strictEqual(await sessionCount(testDb.db, otherId), 1);
    assert.ok(await passwordWorks("real.member@example.com", "their-password"));
    const attempts = await testDb.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM failed_login_attempts WHERE member_id = ?",
      otherId
    );
    assert.strictEqual(attempts?.n, 5);
  });
});
