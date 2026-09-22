/**
 * Migration 057 (ADR-0002): the Canonical name becomes a flagged scientific
 * Name. The database is migrated up to 056, seeded in that shape with raw SQL
 * (the catalogue now writes the flag, so it cannot seed the old shape), then
 * migrated to the end, and every Species must have exactly one flagged
 * scientific Name equal to its cached columns.
 */
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

const FLAG_MIGRATION = 57;
const allMigrations = "./db/migrations";

/**
 * A directory holding the migrations before 057, linked to the real files, so
 * the migrator (and its own parsing) runs them exactly as it runs the rest.
 * Migrating a 057 database with it rolls 057 back.
 */
function migrationsBeforeFlag(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mulm-migrations-"));
  for (const file of fs.readdirSync(allMigrations)) {
    const id = Number(/^(\d+)/.exec(file)?.[1]);
    if (file.endsWith(".sql") && id < FLAG_MIGRATION) {
      fs.symlinkSync(path.resolve(allMigrations, file), path.join(dir, file));
    }
  }
  return dir;
}

let db: Database;
let before057: string;

async function species(genus: string, epithet: string, scientific: string[] = []): Promise<number> {
  const { lastID } = await db.run(
    `INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
     VALUES ('Livebearers', 'Fish', ?, ?)`,
    [genus, epithet]
  );
  for (const name of scientific) {
    await db.run("INSERT INTO species_scientific_name (group_id, scientific_name) VALUES (?, ?)", [
      lastID,
      name,
    ]);
  }
  return lastID as number;
}

async function scientificNames(groupId: number) {
  return db.all<Array<{ id: number; name: string; canonical: number }>>(
    `SELECT scientific_name_id AS id, scientific_name AS name, is_canonical AS canonical
     FROM species_scientific_name WHERE group_id = ? ORDER BY scientific_name_id`,
    [groupId]
  );
}

void describe("Migration 057: Canonical name as a flagged scientific Name", () => {
  beforeEach(async () => {
    before057 = migrationsBeforeFlag();
    db = await open({ filename: ":memory:", driver: sqlite3.Database });
    await db.exec("PRAGMA foreign_keys = ON;");
    await db.migrate({ migrationsPath: before057 });
  });

  afterEach(async () => {
    await db.close();
    fs.rmSync(before057, { recursive: true, force: true });
  });

  void test("gives every Species exactly one flagged scientific Name equal to its cached columns", async () => {
    const exact = await species("Exactus", "exactus", ["Exactus exactus", "Oldus exactus"]);
    const caseOnly = await species("Casus", "onlyus", ["casus onlyus"]);
    const bothCases = await species("Bothus", "casus", ["Bothus Casus", "Bothus casus"]);
    const missing = await species("Missus", "missus", ["Otherus missus"]);
    const nameless = await species("Namelessus", "nullus");
    const trinomial = await species("Corydoras", "aeneus venezuelan");
    // Species A's Canonical name is already a Name of Species B: B keeps it, A gets its own.
    const holder = await species("Holdus", "holdus", ["Sharedus sharedus"]);
    const sharer = await species("Sharedus", "sharedus");
    const { lastID: submission } = await db.run(
      `INSERT INTO submissions (member_id, program, species_type, species_class,
         species_common_name, species_latin_name, reproduction_date, scientific_name_id)
       VALUES (NULL, 'fish', 'Fish', 'Livebearers', 'x', 'casus onlyus', '2026-01-01', ?)`,
      [
        (await db.get<{ id: number }>(
          "SELECT scientific_name_id AS id FROM species_scientific_name WHERE group_id = ?",
          [caseOnly]
        ))!.id,
      ]
    );
    const before = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM species_scientific_name");

    await db.migrate({ migrationsPath: allMigrations });

    const flaggedPerSpecies = await db.all<Array<{ group_id: number; flagged: number; matches: number }>>(
      `SELECT g.group_id,
         (SELECT COUNT(*) FROM species_scientific_name s WHERE s.group_id = g.group_id AND s.is_canonical = 1) AS flagged,
         (SELECT COUNT(*) FROM species_scientific_name s WHERE s.group_id = g.group_id AND s.is_canonical = 1
            AND s.scientific_name = g.canonical_genus || ' ' || g.canonical_species_name) AS matches
       FROM species_name_group g`
    );
    assert.ok(flaggedPerSpecies.length > 8, "the migrations' own Species are covered too");
    for (const row of flaggedPerSpecies) {
      assert.deepStrictEqual(
        { ...row },
        { group_id: row.group_id, flagged: 1, matches: 1 },
        `Species ${row.group_id}`
      );
    }

    // An exact match is flagged, not duplicated; its other Names stay unflagged.
    assert.deepStrictEqual(
      (await scientificNames(exact)).map((n) => [n.name, n.canonical]),
      [
        ["Exactus exactus", 1],
        ["Oldus exactus", 0],
      ]
    );
    // A match in another case only is the same Name: flagged, spelling corrected, id and Submission kept.
    const [corrected] = await scientificNames(caseOnly);
    assert.deepStrictEqual([corrected.name, corrected.canonical], ["Casus onlyus", 1]);
    const referenced = await db.get<{ scientific_name_id: number }>(
      "SELECT scientific_name_id FROM submissions WHERE id = ?",
      [submission]
    );
    assert.strictEqual(referenced?.scientific_name_id, corrected.id);
    // When the exact spelling exists beside another case, the exact one is flagged.
    assert.deepStrictEqual(
      (await scientificNames(bothCases)).map((n) => [n.name, n.canonical]),
      [
        ["Bothus Casus", 0],
        ["Bothus casus", 1],
      ]
    );
    // Absent: added, flagged.
    assert.deepStrictEqual(
      (await scientificNames(missing)).map((n) => [n.name, n.canonical]),
      [
        ["Otherus missus", 0],
        ["Missus missus", 1],
      ]
    );
    assert.deepStrictEqual(
      (await scientificNames(nameless)).map((n) => [n.name, n.canonical]),
      [["Namelessus nullus", 1]]
    );
    assert.deepStrictEqual(
      (await scientificNames(trinomial)).map((n) => [n.name, n.canonical]),
      [["Corydoras aeneus venezuelan", 1]]
    );
    assert.deepStrictEqual(
      (await scientificNames(holder)).map((n) => [n.name, n.canonical]),
      [
        ["Sharedus sharedus", 0],
        ["Holdus holdus", 1],
      ]
    );
    assert.deepStrictEqual(
      (await scientificNames(sharer)).map((n) => [n.name, n.canonical]),
      [["Sharedus sharedus", 1]]
    );

    const after = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM species_scientific_name");
    const seededSpecies = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM species_name_group");
    assert.ok(after!.n - before!.n <= seededSpecies!.n, "at most one Name added per Species");
  });

  void test("the index refuses a second flagged Name for a Species", async () => {
    const id = await species("Indexus", "indexus");
    await db.migrate({ migrationsPath: allMigrations });

    await assert.rejects(
      () =>
        db.run(
          "INSERT INTO species_scientific_name (group_id, scientific_name, is_canonical) VALUES (?, 'Secondus indexus', 1)",
          [id]
        ),
      /UNIQUE constraint/
    );
    // Unflagged Names are as many as the Species has.
    await db.run("INSERT INTO species_scientific_name (group_id, scientific_name) VALUES (?, 'Oldus indexus')", [id]);
    assert.strictEqual((await scientificNames(id)).length, 2);
  });

  void test("rolls back: the flag and index go, the Names stay", async () => {
    const id = await species("Rollus", "backus");
    await db.migrate({ migrationsPath: allMigrations });
    await db.migrate({ migrationsPath: before057 });

    const columns = await db.all<Array<{ name: string }>>("PRAGMA table_info(species_scientific_name)");
    assert.ok(!columns.some((c) => c.name === "is_canonical"));
    assert.deepStrictEqual(
      (
        await db.all<Array<{ scientific_name: string }>>(
          "SELECT scientific_name FROM species_scientific_name WHERE group_id = ?",
          [id]
        )
      ).map((r) => r.scientific_name),
      ["Rollus backus"]
    );
  });
});
