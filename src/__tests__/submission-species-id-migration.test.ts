/**
 * Migrations 058 and 059: a Submission binds to its Species by `species_id`,
 * backfilled from the two Name foreign keys (the common Name's Species first,
 * else the scientific Name's), and then the keys go.
 *
 * The database is migrated up to 057, seeded in that shape with raw SQL, and
 * the old derivation is read off it before migrating on.
 */
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "fs";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { allMigrations, migrationsUpTo } from "./helpers/migrations";

const BINDING_MIGRATION = 58;
const OLD_DERIVATION = `COALESCE(
  (SELECT cn.group_id FROM species_common_name cn WHERE cn.common_name_id = s.common_name_id),
  (SELECT sn.group_id FROM species_scientific_name sn WHERE sn.scientific_name_id = s.scientific_name_id)
)`;

let db: Database;
let before058: string;
let upTo058: string;

async function species(genus: string): Promise<{ id: number; common: number; scientific: number }> {
  const { lastID } = await db.run(
    `INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
     VALUES ('Livebearers', 'Fish', ?, 'bindus')`,
    [genus]
  );
  const common = await db.run("INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)", [
    lastID,
    `${genus} Fish`,
  ]);
  const scientific = await db.run(
    "INSERT INTO species_scientific_name (group_id, scientific_name, is_canonical) VALUES (?, ?, 1)",
    [lastID, `${genus} bindus`]
  );
  return { id: lastID as number, common: common.lastID as number, scientific: scientific.lastID as number };
}

async function submission(keys: { common?: number; scientific?: number }, approved = true): Promise<number> {
  const { lastID } = await db.run(
    `INSERT INTO submissions (program, species_type, species_class, species_common_name, species_latin_name,
       reproduction_date, approved_on, points, common_name_id, scientific_name_id)
     VALUES ('fish', 'Fish', 'Livebearers', 'as typed', 'as typed', '2026-01-01', ?, ?, ?, ?)`,
    [approved ? "2026-02-01" : null, approved ? 10 : null, keys.common ?? null, keys.scientific ?? null]
  );
  return lastID as number;
}

const bindings = () =>
  db.all<Array<{ id: number; species_id: number | null }>>(
    "SELECT id, species_id FROM submissions ORDER BY id"
  );

void describe("Migrations 058-059: Submissions bind by species_id", () => {
  beforeEach(async () => {
    before058 = migrationsUpTo(BINDING_MIGRATION - 1);
    upTo058 = migrationsUpTo(BINDING_MIGRATION);
    db = await open({ filename: ":memory:", driver: sqlite3.Database });
    await db.exec("PRAGMA foreign_keys = ON;");
    await db.migrate({ migrationsPath: before058 });
  });

  afterEach(async () => {
    await db.close();
    for (const dir of [before058, upTo058]) fs.rmSync(dir, { recursive: true, force: true });
  });

  void test("species_id equals the old Name-key derivation for every Submission", async () => {
    const a = await species("Alphus");
    const b = await species("Betus");
    const ids = {
      common: await submission({ common: a.common }),
      scientific: await submission({ scientific: b.scientific }),
      both: await submission({ common: a.common, scientific: a.scientific }),
      disagreeing: await submission({ common: a.common, scientific: b.scientific }),
      unbound: await submission({}),
      draft: await submission({ common: b.common }, false),
    };
    const expected = await db.all<Array<{ id: number; species_id: number | null }>>(
      `SELECT s.id, ${OLD_DERIVATION} AS species_id FROM submissions s ORDER BY s.id`
    );

    await db.migrate({ migrationsPath: upTo058 });

    assert.deepStrictEqual(await bindings(), expected);
    const byId = new Map((await bindings()).map((r) => [r.id, r.species_id]));
    assert.strictEqual(byId.get(ids.common), a.id);
    assert.strictEqual(byId.get(ids.scientific), b.id);
    assert.strictEqual(byId.get(ids.both), a.id);
    assert.strictEqual(byId.get(ids.disagreeing), a.id, "the common Name's Species wins");
    assert.strictEqual(byId.get(ids.unbound), null);
    assert.strictEqual(byId.get(ids.draft), b.id);

    // 059 drops the keys and keeps the binding.
    await db.migrate({ migrationsPath: allMigrations });
    const columns = (await db.all<Array<{ name: string }>>("PRAGMA table_info(submissions)")).map((c) => c.name);
    assert.ok(columns.includes("species_id"));
    assert.ok(!columns.includes("common_name_id"));
    assert.ok(!columns.includes("scientific_name_id"));
    assert.deepStrictEqual(await bindings(), expected);
  });

  void test("rolls back: the keys return, leading to the same Species", async () => {
    const a = await species("Alphus");
    const b = await species("Betus");
    await submission({ common: a.common });
    await submission({ common: a.common, scientific: b.scientific });
    await submission({});
    await db.migrate({ migrationsPath: allMigrations });
    const bound = await bindings();

    await db.migrate({ migrationsPath: before058 });

    const columns = (await db.all<Array<{ name: string }>>("PRAGMA table_info(submissions)")).map((c) => c.name);
    assert.ok(!columns.includes("species_id"));
    assert.deepStrictEqual(
      await db.all(`SELECT s.id, ${OLD_DERIVATION} AS species_id FROM submissions s ORDER BY s.id`),
      bound
    );
  });

  void test("a Species cannot be deleted while a Submission is bound to it", async () => {
    const a = await species("Alphus");
    await submission({ common: a.common });
    await db.migrate({ migrationsPath: allMigrations });

    await assert.rejects(
      () => db.run("DELETE FROM species_name_group WHERE group_id = ?", [a.id]),
      /FOREIGN KEY constraint/
    );
  });
});
