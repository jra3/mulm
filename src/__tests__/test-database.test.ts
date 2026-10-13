import { assertSubmissionInvariantsHold } from "./helpers/assertInvariants";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Database } from "sqlite";
import { db as currentDatabase, ensureReady } from "../db/conn";
import { createTestDatabase } from "./helpers/database";
import { createTestActors, createTestMember, createTestSpeciesName } from "./helpers/fixtures";
import { submissionInState, readSubmission } from "./helpers/lifecycleFixtures";

void describe("disposable test databases", () => {
  void test("creates independent databases without implicit member fixtures", async () => {
    for (let iteration = 0; iteration < 2; iteration++) {
      const database = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
      try {
        assert.equal((await database.db.get("SELECT COUNT(*) AS count FROM members")).count, 0);
        const first = await createTestMember();
        const second = await createTestMember();
        assert.notEqual(first.id, second.id);
        assert.notEqual(first.contact_email, second.contact_email);
        await createTestSpeciesName(database.db);
        assert.equal((await database.db.get("SELECT COUNT(*) AS count FROM members")).count, 2);
        assert.equal((await database.db.get("PRAGMA foreign_keys")).foreign_keys, 1);
        await ensureReady();
        assert.equal(currentDatabase(), database.db);
      } finally {
        await database.cleanup();
      }
      await database.cleanup(); // cleanup is idempotent after success
      await assert.rejects(database.db.get("SELECT 1"), /closed/);
    }
  });

  for (const foreignKeys of ["on", "off"] as const) {
    void test(`preserves the explicit ${foreignKeys} constraint mode`, async () => {
      const database = await createTestDatabase({ foreignKeys, migrations: "latest" });
      try {
        const insert = () =>
          database.db.run(
            "INSERT INTO species_common_name (group_id, common_name) VALUES (999999, 'Orphan')"
          );
        if (foreignKeys === "on") await assert.rejects(insert(), /FOREIGN KEY constraint failed/);
        else await insert();
        assert.equal(
          (await database.db.get("PRAGMA foreign_keys")).foreign_keys,
          foreignKeys === "on" ? 1 : 0
        );
      } finally {
        await database.cleanup();
      }
    });
  }

  void test("actor builders explicitly create committee members and valid lifecycle fixtures", async () => {
    const database = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
    try {
      const actors = await createTestActors(database.db, { adminCount: 2 });
      assert.equal((await database.db.get("SELECT COUNT(*) AS count FROM members")).count, 3);
      assert.equal(
        (await database.db.get("SELECT is_admin FROM members WHERE id = ?", actors.admin.id))
          .is_admin,
        1
      );
      const id = await submissionInState(database.db, "inApprovalQueue", {
        memberId: actors.member.id,
        witnessedBy: actors.admin.id,
      });
      const submission = await readSubmission(id);
      assert.ok(submission);
      await assertSubmissionInvariantsHold(submission);
      assert.equal((await database.db.get("PRAGMA foreign_keys")).foreign_keys, 1);
    } finally {
      await database.cleanup();
    }
  });

  void test("supports empty schemas and migrating to a historical cutoff", async () => {
    const database = await createTestDatabase({ foreignKeys: "off", migrations: false });
    try {
      assert.equal(
        await database.db.get("SELECT name FROM sqlite_master WHERE name = 'members'"),
        undefined
      );
      await database.migrate(56);
      assert.equal((await database.db.get("SELECT MAX(id) AS id FROM migrations")).id, 56);
      await database.migrate(57);
      assert.equal((await database.db.get("SELECT MAX(id) AS id FROM migrations")).id, 57);
      await database.migrate(56);
      assert.equal((await database.db.get("SELECT MAX(id) AS id FROM migrations")).id, 56);
    } finally {
      await database.cleanup();
    }
  });

  void test("closes failed setup and leaves the installed connection untouched", async (t) => {
    const installed = await createTestDatabase({ foreignKeys: "off", migrations: false });
    const opened: Database[] = [];
    const failure = new Error("injected migration failure");
    t.mock.method(Database.prototype, "migrate", function (this: Database) {
      opened.push(this);
      return Promise.reject(failure);
    });
    try {
      await assert.rejects(
        createTestDatabase({ foreignKeys: "on", migrations: "latest" }),
        failure
      );
      assert.equal(opened.length, 1);
      await assert.rejects(opened[0].get("SELECT 1"), /closed/);
      assert.equal(currentDatabase(), installed.db);
      assert.ok(await installed.db.get("SELECT 1"));
    } finally {
      await installed.cleanup();
    }
  });

  void test("surfaces teardown errors and allows retry after fixing an outstanding statement", async () => {
    const database = await createTestDatabase({ foreignKeys: "off", migrations: false });
    const statement = await database.db.prepare("SELECT 1");
    try {
      await assert.rejects(database.cleanup(), /SQLITE_BUSY/);
    } finally {
      await statement.finalize();
      await database.cleanup();
    }
    await assert.rejects(database.db.get("SELECT 1"), /closed/);
  });
});
