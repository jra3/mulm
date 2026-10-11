/**
 * Migration 066 (#524, ADR-0003): Submissions witnessed under the old flow
 * carry no points, and there is no legacy approval path, so they go back to
 * awaiting a Witness. The database is migrated up to 065, seeded with one
 * row of every case the predicate must tell apart, then migrated on: only
 * the witnessed, unapproved, pointless rows change, each one gets the
 * changelog note attributed to its original witness, and afterwards no
 * witnessed, unapproved row lacks points.
 */
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "fs";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { assertNoWitnessedRowLacksPoints } from "./helpers/assertInvariants";
import { allMigrations, migrationsUpTo } from "./helpers/migrations";

const RESET_MIGRATION = 66;
const WITNESSED_ON = "2026-01-02T10:15:00.000Z";
const FINAL_ON = "2026-03-05T19:00:00.000Z";

let db: Database;
let before066: string;

type Row = {
  id: number;
  witness_verification_status: string;
  witnessed_by: number | null;
  witnessed_on: string | null;
  final_submission_on: string | null;
  points: number | null;
  approved_on: string | null;
  article_points: number | null;
  cares_species: number | null;
};

type Note = { submission_id: number; admin_id: number | null; note_text: string };

async function member(name: string): Promise<number> {
  const { lastID } = await db.run(
    "INSERT INTO members (display_name, contact_email, is_admin) VALUES (?, ?, 1)",
    [name, `${name.toLowerCase()}@example.com`]
  );
  return lastID as number;
}

async function submission(
  memberId: number,
  columns: Partial<{
    status: string | null;
    submitted: boolean;
    witnessedBy: number | null;
    witnessedOn: string | null;
    points: number | null;
    approvedOn: string | null;
    finalOn: string | null;
    articlePoints: number | null;
  }> = {}
): Promise<number> {
  const {
    status = "confirmed",
    submitted = true,
    witnessedBy = null,
    witnessedOn = status === "confirmed" || status === "declined" ? WITNESSED_ON : null,
    points = null,
    approvedOn = null,
    finalOn = null,
    articlePoints = null,
  } = columns;
  const { lastID } = await db.run(
    `INSERT INTO submissions (member_id, program, species_type, species_class, species_common_name,
       species_latin_name, reproduction_date, submitted_on, witness_verification_status,
       witnessed_by, witnessed_on, final_submission_on, points, article_points, approved_on, approved_by)
     VALUES (?, 'fish', 'Fish', 'Livebearers', 'Guppy', 'Poecilia reticulata', '2025-11-01', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      memberId,
      submitted ? "2025-12-01T00:00:00.000Z" : null,
      status,
      witnessedBy,
      witnessedOn,
      finalOn,
      points,
      articlePoints,
      approvedOn,
      approvedOn ? witnessedBy : null,
    ]
  );
  return lastID as number;
}

const row = async (id: number): Promise<Row> =>
  (await db.get<Row>(
    `SELECT id, witness_verification_status, witnessed_by, witnessed_on, final_submission_on, points,
            approved_on, article_points, cares_species
       FROM submissions WHERE id = ?`,
    [id]
  ))!;

const notes = (id: number) =>
  db.all<Note[]>(
    "SELECT submission_id, admin_id, note_text FROM submission_notes WHERE submission_id = ? ORDER BY id",
    [id]
  );

const pointlessWitnesses = async (): Promise<number> =>
  (await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM submissions
      WHERE witness_verification_status = 'confirmed' AND approved_on IS NULL AND points IS NULL`
  ))!.n;

void describe("Migration 066: in-flight Submissions go back for a Witness", () => {
  beforeEach(async () => {
    before066 = migrationsUpTo(RESET_MIGRATION - 1);
    // Production runs with foreign keys off, so a witness who has since been
    // deleted is a dangling id, and the migration must cope with one.
    db = await open({ filename: ":memory:", driver: sqlite3.Database });
    await db.exec("PRAGMA foreign_keys = OFF;");
    await db.migrate({ migrationsPath: before066 });
  });

  afterEach(async () => {
    await db.close();
    fs.rmSync(before066, { recursive: true, force: true });
  });

  /** One row of every case the predicate must tell apart. */
  async function seed() {
    const jane = await member("Jane");
    const pat = await member("Pat");
    return {
      pat,
      // Witnessed under the old flow: confirmed, unapproved, no points
      reset: await submission(jane, { witnessedBy: pat, finalOn: FINAL_ON }),
      // The same, with a bonus flag left over and a witness no longer a member
      resetOrphan: await submission(jane, { witnessedBy: 9999, articlePoints: 0 }),
      // Witnessed under the new flow: it carries its points
      newFlow: await submission(jane, { witnessedBy: pat, points: 15 }),
      // Approved: the Witness is history, the points awarded
      approved: await submission(jane, { witnessedBy: pat, points: 10, approvedOn: "2026-02-01T00:00:00.000Z" }),
      // Already awaiting a Witness
      pending: await submission(jane, { status: "pending" }),
      // Never submitted
      draft: await submission(jane, { status: null, submitted: false }),
      // The dead 'declined' value, which already derives as awaiting a Witness
      declined: await submission(jane, { status: "declined", witnessedBy: pat }),
    };
  }

  void test("resets exactly the witnessed, unapproved, pointless rows and leaves every other row untouched", async () => {
    const ids = await seed();
    const untouched = ["newFlow", "approved", "pending", "draft", "declined"] as const;
    const before = Object.fromEntries(await Promise.all(untouched.map(async (k) => [k, await row(ids[k])])));
    assert.strictEqual(await pointlessWitnesses(), 2, "the fixture has the rows the migration is for");

    await db.migrate({ migrationsPath: allMigrations });

    for (const k of untouched) {
      assert.deepStrictEqual(await row(ids[k]), before[k], `${k} is untouched`);
      assert.deepStrictEqual(await notes(ids[k]), [], `${k} gets no note`);
    }
    for (const id of [ids.reset, ids.resetOrphan]) {
      const after = await row(id);
      assert.strictEqual(after.witness_verification_status, "pending");
      assert.strictEqual(after.witnessed_by, null);
      assert.strictEqual(after.witnessed_on, null);
      assert.strictEqual(after.final_submission_on, null);
      assert.strictEqual(after.points, null);
      assert.strictEqual(after.article_points, null, "cleared as a voided Witness clears it");
      assert.strictEqual(after.approved_on, null);
    }
    await assertNoWitnessedRowLacksPoints(db);
  });

  void test("each reset row gets the changelog note attributed to its original witness", async () => {
    const ids = await seed();

    await db.migrate({ migrationsPath: allMigrations });

    assert.deepStrictEqual(await notes(ids.reset), [
      {
        submission_id: ids.reset,
        admin_id: ids.pat,
        note_text: "Witness reset when points moved to the Witness; originally witnessed by Pat on 2026-01-02",
      },
    ]);
    // A witness who is no longer a member is named as such, and the note is
    // attributed to nobody rather than to a member who does not exist.
    assert.deepStrictEqual(await notes(ids.resetOrphan), [
      {
        submission_id: ids.resetOrphan,
        admin_id: null,
        note_text:
          "Witness reset when points moved to the Witness; originally witnessed by a former committee member on 2026-01-02",
      },
    ]);
  });

  void test("rolls back: the Witness returns from the note, to the day, where nobody has re-witnessed since", async () => {
    const ids = await seed();
    await db.migrate({ migrationsPath: allMigrations });
    // One reset row has been re-witnessed under the new flow meanwhile
    await db.run(
      `UPDATE submissions SET witness_verification_status = 'confirmed', witnessed_by = ?, witnessed_on = ?, points = 10
        WHERE id = ?`,
      [ids.pat, "2026-10-12T00:00:00.000Z", ids.resetOrphan]
    );

    await db.migrate({ migrationsPath: before066 });

    const restored = await row(ids.reset);
    assert.strictEqual(restored.witness_verification_status, "confirmed");
    assert.strictEqual(restored.witnessed_by, ids.pat);
    assert.strictEqual(restored.witnessed_on, "2026-01-02");
    assert.strictEqual(restored.final_submission_on, null, "the dead column is not resurrected");
    assert.deepStrictEqual(await notes(ids.reset), [], "the note goes with the reset");

    const rewitnessed = await row(ids.resetOrphan);
    assert.strictEqual(rewitnessed.witnessed_on, "2026-10-12T00:00:00.000Z", "a newer Witness stands");
    assert.strictEqual(rewitnessed.points, 10);
    assert.deepStrictEqual(await notes(ids.resetOrphan), []);
  });
});
