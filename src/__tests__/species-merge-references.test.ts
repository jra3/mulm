/**
 * Merge and delete account for everything else that points at a Species
 * (#420): a member's collection, CARES articles and fry shares, images,
 * external links, and the IUCN and external-data sync records.
 *
 * Production runs with foreign keys off, so nothing cascades there: a row the
 * catalogue does not move or remove is left pointing at a Species that no
 * longer exists. These tests run with foreign keys ON (as the other suites
 * do) and also check no row is left behind by the ids themselves.
 */
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import { createMember } from "../db/members";
import { speciesReferenceTables } from "../species/references";
import {
  createSpecies,
  mergeSpecies,
  deleteSpecies,
  previewMerge,
  CatalogueRefusal,
} from "@/species";

let db: Database;
let alice: number;
let bob: number;

async function createTestSpecies(genus: string, epithet: string): Promise<number> {
  return createSpecies({
    canonicalGenus: genus,
    canonicalSpeciesName: epithet,
    programClass: "Livebearers",
    speciesType: "Fish",
  });
}

async function addToCollection(
  memberId: number,
  groupId: number,
  opts: { removed?: string; caresRegistered?: string } = {}
): Promise<number> {
  const { lastID } = await db.run(
    `INSERT INTO species_collection (member_id, group_id, removed_date, cares_registered_at)
     VALUES (?, ?, ?, ?)`,
    [memberId, groupId, opts.removed ?? null, opts.caresRegistered ?? null]
  );
  return lastID as number;
}

async function addCaresRecords(memberId: number, groupId: number) {
  await db.run(
    "INSERT INTO cares_article (member_id, species_group_id, title) VALUES (?, ?, 'Spawning notes')",
    [memberId, groupId]
  );
  await db.run(
    `INSERT INTO cares_fry_share (member_id, species_group_id, recipient_name, share_date)
     VALUES (?, ?, 'A friend', '2026-01-01')`,
    [memberId, groupId]
  );
}

async function addEnrichment(groupId: number, url: string) {
  await db.run(
    "INSERT INTO species_images (group_id, image_url, display_order) VALUES (?, ?, 0)",
    [groupId, `https://img.example/${url}`]
  );
  await db.run(
    "INSERT INTO species_external_references (group_id, reference_url, display_order) VALUES (?, ?, 0)",
    [groupId, `https://ref.example/${url}`]
  );
  await db.run(
    "INSERT INTO external_data_sync_log (group_id, source, sync_date, status) VALUES (?, 'gbif', '2026-01-01', 'success')",
    [groupId]
  );
  await db.run("INSERT INTO iucn_sync_log (group_id, status) VALUES (?, 'success')", [groupId]);
  await db.run(
    `INSERT INTO iucn_canonical_recommendations (group_id, current_canonical_genus, current_canonical_species,
       suggested_canonical_genus, suggested_canonical_species, iucn_taxon_id, reason)
     VALUES (?, 'Oldus', 'name', 'Newus', 'name', 1, 'synonym')`,
    [groupId]
  );
}

async function rowsFor(groupId: number): Promise<Record<string, number>> {
  const count = async (sql: string) => (await db.get<{ n: number }>(sql, [groupId]))!.n;
  return {
    collection: await count("SELECT COUNT(*) AS n FROM species_collection WHERE group_id = ?"),
    caresArticles: await count("SELECT COUNT(*) AS n FROM cares_article WHERE species_group_id = ?"),
    caresFryShares: await count("SELECT COUNT(*) AS n FROM cares_fry_share WHERE species_group_id = ?"),
    images: await count("SELECT COUNT(*) AS n FROM species_images WHERE group_id = ?"),
    externalReferences: await count(
      "SELECT COUNT(*) AS n FROM species_external_references WHERE group_id = ?"
    ),
    externalSyncLog: await count("SELECT COUNT(*) AS n FROM external_data_sync_log WHERE group_id = ?"),
    iucnSyncLog: await count("SELECT COUNT(*) AS n FROM iucn_sync_log WHERE group_id = ?"),
    iucnRecommendations: await count(
      "SELECT COUNT(*) AS n FROM iucn_canonical_recommendations WHERE group_id = ?"
    ),
  };
}

const none = {
  collection: 0,
  caresArticles: 0,
  caresFryShares: 0,
  images: 0,
  externalReferences: 0,
  externalSyncLog: 0,
  iucnSyncLog: 0,
  iucnRecommendations: 0,
};

beforeEach(async () => {
  db = await open({ filename: ":memory:", driver: sqlite3.Database });
  await db.exec("PRAGMA foreign_keys = ON;");
  await db.migrate({ migrationsPath: "./db/migrations" });
  overrideConnection(db);
  alice = await createMember("alice@example.com", "Alice");
  bob = await createMember("bob@example.com", "Bob");
});

afterEach(async () => {
  await db.close();
});

void describe("merge", () => {
  void test("moves the loser's collection entries and CARES records to the winner", async () => {
    const winner = await createTestSpecies("Winnerus", "maximus");
    const loser = await createTestSpecies("Loserus", "minimus");
    await addToCollection(alice, loser, { caresRegistered: "2026-02-01" });
    await addToCollection(bob, loser, { removed: "2025-12-01" });
    await addCaresRecords(alice, loser);

    await mergeSpecies(winner, loser);

    const moved = await rowsFor(winner);
    assert.strictEqual(moved.collection, 2);
    assert.strictEqual(moved.caresArticles, 1);
    assert.strictEqual(moved.caresFryShares, 1);
    const entry = await db.get<{ cares_registered_at: string }>(
      "SELECT cares_registered_at FROM species_collection WHERE member_id = ? AND group_id = ?",
      [alice, winner]
    );
    assert.strictEqual(entry!.cares_registered_at, "2026-02-01");
    assert.deepStrictEqual(await rowsFor(loser), none);
  });

  void test("moves images and links, dropping the ones the winner already has", async () => {
    const winner = await createTestSpecies("Winnerus", "maximus");
    const loser = await createTestSpecies("Loserus", "minimus");
    await addEnrichment(winner, "shared");
    await addEnrichment(loser, "shared");
    await db.run(
      "INSERT INTO species_images (group_id, image_url, display_order) VALUES (?, 'https://img.example/only-loser', 0)",
      [loser]
    );

    await mergeSpecies(winner, loser);

    const images = await db.all<Array<{ image_url: string; display_order: number }>>(
      "SELECT image_url, display_order FROM species_images WHERE group_id = ? ORDER BY display_order",
      [winner]
    );
    assert.deepStrictEqual(
      images.map((i) => i.image_url),
      ["https://img.example/shared", "https://img.example/only-loser"],
      "the winner's images first, then the loser's it lacked"
    );
    assert.strictEqual((await rowsFor(winner)).externalReferences, 1);
    assert.deepStrictEqual(await rowsFor(loser), none);
  });

  void test("drops the loser's sync logs and IUCN recommendations; the winner keeps its own", async () => {
    const winner = await createTestSpecies("Winnerus", "maximus");
    const loser = await createTestSpecies("Loserus", "minimus");
    await addEnrichment(winner, "w");
    await addEnrichment(loser, "l");

    await mergeSpecies(winner, loser);

    const kept = await rowsFor(winner);
    assert.strictEqual(kept.externalSyncLog, 1);
    assert.strictEqual(kept.iucnSyncLog, 1);
    assert.strictEqual(kept.iucnRecommendations, 1);
    assert.deepStrictEqual(await rowsFor(loser), none);
  });

  void test("is refused while a member keeps both Species, and changes nothing", async () => {
    const winner = await createTestSpecies("Winnerus", "maximus");
    const loser = await createTestSpecies("Loserus", "minimus");
    await addToCollection(alice, winner);
    await addToCollection(alice, loser);
    await addToCollection(bob, loser);

    await assert.rejects(
      () => mergeSpecies(winner, loser),
      (err: unknown) =>
        err instanceof CatalogueRefusal && err.code === "referenced" && /Alice/.test(err.message)
    );
    assert.strictEqual((await rowsFor(loser)).collection, 2);
    assert.ok(await db.get("SELECT 1 FROM species_name_group WHERE group_id = ?", [loser]));
  });

  void test("a member who removed one of the two may still be merged", async () => {
    const winner = await createTestSpecies("Winnerus", "maximus");
    const loser = await createTestSpecies("Loserus", "minimus");
    await addToCollection(alice, winner);
    await addToCollection(alice, loser, { removed: "2025-06-01" });

    await mergeSpecies(winner, loser);
    assert.strictEqual((await rowsFor(winner)).collection, 2);
  });

  void test("leaves nothing on the loser with foreign keys off, as production runs", async () => {
    await db.exec("PRAGMA foreign_keys = OFF;");
    const winner = await createTestSpecies("Winnerus", "maximus");
    const loser = await createTestSpecies("Loserus", "minimus");
    await addToCollection(alice, loser);
    await addCaresRecords(alice, loser);
    await addEnrichment(loser, "l");

    await mergeSpecies(winner, loser);

    assert.deepStrictEqual(await rowsFor(loser), none);
    const moved = await rowsFor(winner);
    assert.strictEqual(moved.collection, 1);
    assert.strictEqual(moved.caresArticles, 1);
    assert.strictEqual(moved.images, 1);
  });

  void test("the preview counts what moves and names who blocks it", async () => {
    const winner = await createTestSpecies("Winnerus", "maximus");
    const loser = await createTestSpecies("Loserus", "minimus");
    await addToCollection(alice, winner);
    await addToCollection(alice, loser);
    await addToCollection(bob, loser);
    await addCaresRecords(bob, loser);
    await addEnrichment(loser, "l");

    const plan = await previewMerge(winner, loser);
    assert.deepStrictEqual(plan.references, {
      collection: 2,
      caresArticles: 1,
      caresFryShares: 1,
      images: 1,
      externalReferences: 1,
    });
    assert.deepStrictEqual(plan.collectionConflicts, [{ memberId: alice, displayName: "Alice" }]);
  });
});

void describe("delete", () => {
  void test("is refused while a member's collection holds the Species", async () => {
    const id = await createTestSpecies("Keptus", "species");
    await addToCollection(alice, id, { removed: "2025-01-01" });

    await assert.rejects(
      () => deleteSpecies(id),
      (err: unknown) =>
        err instanceof CatalogueRefusal && err.code === "referenced" && /collection/.test(err.message)
    );
    assert.strictEqual((await rowsFor(id)).collection, 1);
  });

  void test("is refused while a CARES record names the Species", async () => {
    const id = await createTestSpecies("Caresus", "species");
    await addCaresRecords(alice, id);

    await assert.rejects(
      () => deleteSpecies(id),
      (err: unknown) => err instanceof CatalogueRefusal && err.code === "referenced" && /CARES/.test(err.message)
    );
  });

  void test("removes its images, links, sync logs and IUCN recommendations with it", async () => {
    const id = await createTestSpecies("Goneus", "species");
    await addEnrichment(id, "g");

    await deleteSpecies(id);

    assert.deepStrictEqual(await rowsFor(id), none);
  });

  void test("removes them even with foreign keys off, as production runs", async () => {
    await db.exec("PRAGMA foreign_keys = OFF;");
    const id = await createTestSpecies("Goneus", "species");
    await addEnrichment(id, "g");

    await deleteSpecies(id);

    assert.deepStrictEqual(await rowsFor(id), none);
  });
});

void describe("every table that holds a Species id", () => {
  void test("is handled by merge and delete", async () => {
    const tables = await db.all<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    );
    const referencing: string[] = [];
    for (const { name } of tables) {
      const keys = await db.all<Array<{ table: string }>>(`PRAGMA foreign_key_list("${name}")`);
      if (keys.some((k) => k.table === "species_name_group")) referencing.push(name);
    }
    const catalogueOwn = ["species_common_name", "species_scientific_name", "submissions"];
    assert.deepStrictEqual(
      referencing.filter((t) => !catalogueOwn.includes(t)).sort(),
      [...speciesReferenceTables].sort(),
      "a new table referencing species_name_group needs a place in src/species/references.ts"
    );
  });
});
