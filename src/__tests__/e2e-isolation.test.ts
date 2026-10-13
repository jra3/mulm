import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { e2eDatabaseFile } from "../../e2e/helpers/database";
import {
  createTestSubmission,
  getTestDatabase,
  ensureTestUserExists,
  removeOwnedMembers,
} from "../../e2e/helpers/testData";

void test("E2E requires an owned database and cleanup leaves another active member's resources intact", async () => {
  const previousFile = process.env.MULM_E2E_DATABASE;
  const previousRun = process.env.MULM_E2E_RUN;
  delete process.env.MULM_E2E_DATABASE;
  delete process.env.MULM_E2E_RUN;
  assert.throws(e2eDatabaseFile, /allocated by Playwright/);
  const directory = await mkdtemp(join(tmpdir(), "mulm-e2e-isolation-"));
  try {
    const filename = join(directory, "database.db");
    process.env.MULM_E2E_DATABASE = filename;
    process.env.MULM_E2E_RUN = randomUUID();
    await writeFile(join(directory, "owner"), "another run");
    assert.throws(e2eDatabaseFile, /allocated by Playwright/);
    await writeFile(join(directory, "owner"), process.env.MULM_E2E_RUN);
    const initialized = await open({ filename, driver: sqlite3.Database });
    await initialized.migrate({ migrationsPath: "./db/migrations" });
    await initialized.close();
    const owner = await ensureTestUserExists("owner@example.invalid", "password", "Owner");
    const neighbor = await ensureTestUserExists("neighbor@example.invalid", "password", "Neighbor");
    const connection = await getTestDatabase();
    try {
      const create = async (member: number) => {
        const id = await createTestSubmission(member, { speciesType: "Plant" });
        await connection.run(
          "INSERT INTO submission_supplements (submission_id, supplement_type, supplement_regimen) VALUES (?, 'iron', 'weekly')",
          id
        );
        await connection.run(
          "INSERT INTO submission_notes (submission_id, admin_id, note_text) VALUES (?, ?, 'Owned note')",
          id,
          member
        );
        return id;
      };
      const removed = await create(owner);
      const retained = await create(neighbor);
      const catalogue = await connection.get<{ count: number }>(
        "SELECT COUNT(*) count FROM species_name_group"
      );
      await removeOwnedMembers([owner]);
      assert.equal(await connection.get("SELECT id FROM members WHERE id = ?", owner), undefined);
      assert.equal(
        await connection.get("SELECT id FROM submissions WHERE id = ?", removed),
        undefined
      );
      assert.equal(
        await connection.get("SELECT id FROM submission_notes WHERE submission_id = ?", removed),
        undefined
      );
      assert.equal(
        await connection.get(
          "SELECT id FROM submission_supplements WHERE submission_id = ?",
          removed
        ),
        undefined
      );
      assert.ok(await connection.get("SELECT id FROM members WHERE id = ?", neighbor));
      assert.ok(await connection.get("SELECT id FROM submissions WHERE id = ?", retained));
      assert.ok(
        await connection.get("SELECT id FROM submission_notes WHERE submission_id = ?", retained)
      );
      assert.ok(
        await connection.get(
          "SELECT id FROM submission_supplements WHERE submission_id = ?",
          retained
        )
      );
      assert.deepEqual(
        await connection.get("SELECT COUNT(*) count FROM species_name_group"),
        catalogue
      );
      assert.deepEqual(await connection.all("PRAGMA foreign_key_check"), []);
      await removeOwnedMembers([neighbor]);
    } finally {
      await connection.close();
    }
  } finally {
    if (previousFile === undefined) delete process.env.MULM_E2E_DATABASE;
    else process.env.MULM_E2E_DATABASE = previousFile;
    if (previousRun === undefined) delete process.env.MULM_E2E_RUN;
    else process.env.MULM_E2E_RUN = previousRun;
    await rm(directory, { recursive: true, force: true });
  }
});
