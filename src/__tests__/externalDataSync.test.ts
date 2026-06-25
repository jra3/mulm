import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import type { Database } from "sqlite";
import { runExternalDataSync, type EnrichmentClients } from "@/services/externalDataSync";
import {
  getSpeciesExternalReferences,
  getSpeciesImages,
  setSpeciesExternalReferences,
} from "@/db/species";
import { getAllSyncLog } from "@/db/external-data-sync";
import { setupTestDatabase, teardownTestDatabase, type TestContext } from "./helpers/testHelpers";

const insertSpecies = (db: Database, groupId: number, genus: string, species: string) =>
  db.run(
    `INSERT INTO species_name_group
       (group_id, program_class, canonical_genus, canonical_species_name, species_type)
     VALUES (?, 'Cyprinids', ?, ?, 'Fish')`,
    [groupId, genus, species]
  );

// Fake clients: respond per-genus so we can model success / not-found / error.
const clients: EnrichmentClients = {
  wikipedia: {
    getExternalData: (genus: string) => {
      if (genus === "Boom") return Promise.reject(new Error("wiki upstream 500"));
      if (genus === "Danio") {
        return Promise.resolve({
          wikidataUrl: "https://www.wikidata.org/wiki/Q1",
          wikipediaUrls: { en: "https://en.wikipedia.org/wiki/Danio_rerio" },
          imageUrls: ["https://upload.wikimedia.org/danio.jpg"],
        });
      }
      return Promise.resolve(null); // not found
    },
  },
  gbif: {
    getExternalData: () =>
      Promise.resolve({
        gbifUrl: "https://www.gbif.org/species/123",
        occurrenceMapUrl: "https://api.gbif.org/v2/map/123.png",
        imageUrls: ["https://api.gbif.org/img.jpg"],
      }),
  },
};

void describe("externalDataSync.runExternalDataSync", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase({ adminCount: 1 });
    // Migrations seed the species catalog; start from a clean slate so the sync
    // only sees our fixtures and the log counts are deterministic.
    await ctx.db.exec(
      `DELETE FROM species_name_group;
       DELETE FROM external_data_sync_log;
       DELETE FROM species_external_references;
       DELETE FROM species_images;`
    );
    await insertSpecies(ctx.db, 100, "Danio", "rerio"); // wiki + gbif hit
    await insertSpecies(ctx.db, 101, "Poecilia", "reticulata"); // wiki not-found, gbif hit
    await insertSpecies(ctx.db, 102, "Boom", "boom"); // wiki throws, gbif hit
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void test("syncs references/images and records per-source log", async () => {
    const summary = await runExternalDataSync({ limit: 10 }, clients);

    assert.strictEqual(summary.processed, 3);
    assert.strictEqual(summary.notFound, 1, "Poecilia wikipedia → not found");
    assert.strictEqual(summary.errors, 1, "Boom wikipedia → error");

    // group 100 got both Wikipedia and GBIF references
    const refs = (await getSpeciesExternalReferences(100)).map((r) => r.reference_url);
    assert.ok(refs.includes("https://www.wikidata.org/wiki/Q1"));
    assert.ok(refs.includes("https://en.wikipedia.org/wiki/Danio_rerio"));
    assert.ok(refs.includes("https://www.gbif.org/species/123"));
    assert.ok(refs.includes("https://api.gbif.org/v2/map/123.png"));

    const images = (await getSpeciesImages(100)).map((i) => i.image_url);
    assert.ok(images.includes("https://upload.wikimedia.org/danio.jpg"));
    assert.ok(images.includes("https://api.gbif.org/img.jpg"));

    // group 102 still gets GBIF data even though Wikipedia errored
    const refs102 = (await getSpeciesExternalReferences(102)).map((r) => r.reference_url);
    assert.ok(refs102.includes("https://www.gbif.org/species/123"));

    // log has an entry per source per species (6 total)
    const log = await getAllSyncLog(ctx.db);
    assert.strictEqual(log.length, 6);
    assert.ok(log.some((e) => e.source === "wikipedia" && e.status === "not_found"));
    assert.ok(log.some((e) => e.source === "wikipedia" && e.status === "error"));
  });

  void test("is additive — preserves pre-existing references", async () => {
    await setSpeciesExternalReferences(100, ["https://example.com/manual"]);

    await runExternalDataSync({ limit: 10 }, clients);

    const refs = (await getSpeciesExternalReferences(100)).map((r) => r.reference_url);
    assert.ok(refs.includes("https://example.com/manual"), "manual ref preserved");
    assert.ok(refs.includes("https://www.gbif.org/species/123"), "synced ref added");
  });

  void test("skips species synced within the staleness window on a second run", async () => {
    const first = await runExternalDataSync({ limit: 10 }, clients);
    assert.strictEqual(first.processed, 3);

    // every species had at least one successful source → last_external_sync set
    const second = await runExternalDataSync({ limit: 10 }, clients);
    assert.strictEqual(second.processed, 0);
  });

  void test("respects the limit", async () => {
    const summary = await runExternalDataSync({ limit: 1 }, clients);
    assert.strictEqual(summary.processed, 1);
  });
});
