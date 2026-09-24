/**
 * Name text edges (#423): search treats `%` and `_` as the characters they
 * are, and a Canonical name differing only in case is the same Canonical name.
 */
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import fs from "fs";
import { migrationsUpTo } from "./helpers/migrations";
import { overrideConnection } from "../db/conn";
import {
  createSpecies,
  addName,
  renameCanonical,
  findSpeciesById,
  searchSpeciesTypeahead,
  getSpeciesForAdmin,
  getSpeciesForExplorer,
  CatalogueRefusal,
} from "@/species";

let db: Database;

async function createTestSpecies(genus: string, epithet: string, common?: string): Promise<number> {
  const id = await createSpecies({
    canonicalGenus: genus,
    canonicalSpeciesName: epithet,
    programClass: "Cichlids - New World",
    speciesType: "Fish",
  });
  if (common) await addName(id, "common", common);
  return id;
}

beforeEach(async () => {
  db = await open({ filename: ":memory:", driver: sqlite3.Database });
  await db.exec("PRAGMA foreign_keys = ON;");
  await db.migrate({ migrationsPath: "./db/migrations" });
  overrideConnection(db);
});

afterEach(async () => {
  await db.close();
});

void describe("search matches % and _ literally", () => {
  beforeEach(async () => {
    await createTestSpecies("Testfolia", "abbreviata", "African leaffish");
    await createTestSpecies("Testgramma", "sp. 100%", "Apisto 100% red");
    await createTestSpecies("Testgramma", "sp_blue", "Blue_line apisto");
  });

  void test("typeahead", async () => {
    assert.deepStrictEqual(await searchSpeciesTypeahead("a_Fish"), []);
    assert.deepStrictEqual(await searchSpeciesTypeahead("%%"), []);
    assert.deepStrictEqual(
      (await searchSpeciesTypeahead("100%")).map((r) => r.common_name),
      ["Apisto 100% red", "Apisto 100% red"]
    );
    assert.deepStrictEqual(
      [...new Set((await searchSpeciesTypeahead("e_l")).map((r) => r.common_name))],
      ["Blue_line apisto"]
    );
  });

  void test("admin list", async () => {
    assert.strictEqual((await getSpeciesForAdmin({ search: "a_Fish" })).total_count, 0);
    assert.strictEqual((await getSpeciesForAdmin({ search: "%%" })).total_count, 0);
    assert.deepStrictEqual(
      (await getSpeciesForAdmin({ search: "e_l" })).species.map((s) => s.canonical_species_name),
      ["sp_blue"]
    );
  });

  void test("a backslash in the search is only a backslash", async () => {
    assert.deepStrictEqual(await searchSpeciesTypeahead("\\_"), []);
    assert.strictEqual((await getSpeciesForAdmin({ search: "\\%" })).total_count, 0);
  });

  void test("explorer", async () => {
    assert.deepStrictEqual(await getSpeciesForExplorer({ search: "a_Fish" }), []);
    assert.deepStrictEqual(await getSpeciesForExplorer({ search: "%%" }), []);
  });
});

void describe("a Canonical name is unique whatever its case", () => {
  void test("create refuses a case variant of another Species' Canonical name", async () => {
    await createTestSpecies("Testilia", "reticulata");
    await assert.rejects(
      () => createTestSpecies("testilia", "Reticulata"),
      (err: unknown) => err instanceof CatalogueRefusal && err.code === "duplicate"
    );
  });

  void test("rename refuses a case variant of another Species' Canonical name", async () => {
    await createTestSpecies("Testilia", "reticulata");
    const other = await createTestSpecies("Testophorus", "maculatus");
    await assert.rejects(
      () => renameCanonical(other, "testilia", "Reticulata"),
      (err: unknown) => err instanceof CatalogueRefusal && err.code === "duplicate"
    );
    assert.strictEqual((await findSpeciesById(other))?.canonical_genus, "Testophorus");
  });

  void test("a Species may still fix the case of its own Canonical name", async () => {
    const id = await createTestSpecies("testilia", "reticulata");
    await renameCanonical(id, "Testilia", "reticulata");
    assert.strictEqual((await findSpeciesById(id))?.canonical_genus, "Testilia");
  });
});

void describe("migration 060", () => {
  void test("refuses to run while two Species share a Canonical name up to case", async () => {
    const before060 = migrationsUpTo(59);
    const raw = await open({ filename: ":memory:", driver: sqlite3.Database });
    try {
      await raw.migrate({ migrationsPath: before060 });
      for (const genus of ["Testilia", "testilia"]) {
        await raw.run(
          `INSERT INTO species_name_group (program_class, species_type, canonical_genus, canonical_species_name)
           VALUES ('Livebearers', 'Fish', ?, 'reticulata')`,
          [genus]
        );
      }

      await assert.rejects(
        () => raw.migrate({ migrationsPath: "./db/migrations" }),
        /UNIQUE constraint failed/
      );
      const applied = await raw.get<{ id: number }>("SELECT MAX(id) AS id FROM migrations");
      assert.strictEqual(applied!.id, 59, "060 is not recorded as applied");
      const index = await raw.get(
        "SELECT 1 FROM sqlite_master WHERE name = 'idx_species_name_group_canonical_nocase'"
      );
      assert.strictEqual(index, undefined);
    } finally {
      await raw.close();
      fs.rmSync(before060, { recursive: true, force: true });
    }
  });
});
