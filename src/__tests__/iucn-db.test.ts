import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestSpeciesName,
  type TestContext,
} from "./helpers/testHelpers";
// Import functions we're testing
import {
  updateIucnData,
  recordIucnSync,
  getIucnSyncLog,
  getSpeciesWithMissingIucn,
  getSpeciesNeedingResync,
  getIucnSyncStats,
  type IUCNData,
} from "../db/iucn";

void describe("IUCN Database Operations", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void describe("updateIucnData", () => {
    void test("should update IUCN data for a species group", async () => {
      // Create a test species
      const species = await createTestSpeciesName(
        ctx.db,
        "Peppered Cory",
        "Corydoras paleatus",
        "Corydoras",
        "paleatus",
        "Catfish"
      );

      // Update with IUCN data
      const iucnData: IUCNData = {
        category: "VU",
        taxonId: 123456,
        populationTrend: "Decreasing",
      };

      await updateIucnData(ctx.db, species.group_id, iucnData);

      // Verify the update
      const result = await ctx.db.get(
        `SELECT iucn_redlist_category, iucn_redlist_id, iucn_population_trend, iucn_last_updated
         FROM species_name_group WHERE group_id = ?`,
        [species.group_id]
      );

      assert.strictEqual(result.iucn_redlist_category, "VU");
      assert.strictEqual(result.iucn_redlist_id, 123456);
      assert.strictEqual(result.iucn_population_trend, "Decreasing");
      assert.ok(result.iucn_last_updated); // Should be set
    });

    void test("should update only category if other fields not provided", async () => {
      const species = await createTestSpeciesName(
        ctx.db,
        "Test Species",
        "Testus species",
        "Testus",
        "species",
        "Test"
      );

      await updateIucnData(ctx.db, species.group_id, { category: "EN" });

      const result = await ctx.db.get(
        `SELECT iucn_redlist_category, iucn_redlist_id FROM species_name_group WHERE group_id = ?`,
        [species.group_id]
      );

      assert.strictEqual(result.iucn_redlist_category, "EN");
      assert.strictEqual(result.iucn_redlist_id, null);
    });

    void test("should update existing IUCN data", async () => {
      const species = await createTestSpeciesName(
        ctx.db,
        "Test Species",
        "Testus update",
        "Testus",
        "update",
        "Test"
      );

      // First update
      await updateIucnData(ctx.db, species.group_id, { category: "VU" });

      // Second update (status changed)
      await updateIucnData(ctx.db, species.group_id, {
        category: "EN",
        taxonId: 999,
      });

      const result = await ctx.db.get(
        `SELECT iucn_redlist_category, iucn_redlist_id FROM species_name_group WHERE group_id = ?`,
        [species.group_id]
      );

      assert.strictEqual(result.iucn_redlist_category, "EN");
      assert.strictEqual(result.iucn_redlist_id, 999);
    });
  });

  void describe("recordIucnSync", () => {
    void test("should log successful sync", async () => {
      const species = await createTestSpeciesName(
        ctx.db,
        "Test Species",
        "Testus sync",
        "Testus",
        "sync",
        "Test"
      );

      await recordIucnSync(ctx.db, species.group_id, "success", {
        category: "CR",
      });

      const log = await ctx.db.get(
        `SELECT * FROM iucn_sync_log WHERE group_id = ? ORDER BY sync_date DESC LIMIT 1`,
        [species.group_id]
      );

      assert.strictEqual(log.group_id, species.group_id);
      assert.strictEqual(log.status, "success");
      assert.strictEqual(log.category_found, "CR");
      assert.strictEqual(log.error_message, null);
    });

    void test("should log not_found status", async () => {
      const species = await createTestSpeciesName(
        ctx.db,
        "Obscure Species",
        "Obscurus notfound",
        "Obscurus",
        "notfound",
        "Test"
      );

      await recordIucnSync(ctx.db, species.group_id, "not_found");

      const log = await ctx.db.get(
        `SELECT * FROM iucn_sync_log WHERE group_id = ?`,
        [species.group_id]
      );

      assert.strictEqual(log.status, "not_found");
      assert.strictEqual(log.category_found, null);
    });

    void test("should log API errors with message", async () => {
      const species = await createTestSpeciesName(
        ctx.db,
        "Error Species",
        "Errorus test",
        "Errorus",
        "test",
        "Test"
      );

      await recordIucnSync(
        ctx.db,
        species.group_id,
        "api_error",
        undefined,
        "Network timeout after 10s"
      );

      const log = await ctx.db.get(
        `SELECT * FROM iucn_sync_log WHERE group_id = ?`,
        [species.group_id]
      );

      assert.strictEqual(log.status, "api_error");
      assert.strictEqual(log.error_message, "Network timeout after 10s");
    });

    void test("should support csv_import status", async () => {
      const species = await createTestSpeciesName(
        ctx.db,
        "CSV Species",
        "CSVus importus",
        "CSVus",
        "importus",
        "Test"
      );

      await recordIucnSync(ctx.db, species.group_id, "csv_import", {
        category: "VU",
      });

      const log = await ctx.db.get(
        `SELECT * FROM iucn_sync_log WHERE group_id = ?`,
        [species.group_id]
      );

      assert.strictEqual(log.status, "csv_import");
      assert.strictEqual(log.category_found, "VU");
    });
  });

  void describe("getIucnSyncLog", () => {
    void test("should return sync history for a species", async () => {
      const species = await createTestSpeciesName(
        ctx.db,
        "Multi-sync Species",
        "Multus syncus",
        "Multus",
        "syncus",
        "Test"
      );

      // Create multiple sync attempts
      await recordIucnSync(ctx.db, species.group_id, "api_error", undefined, "Error 1");
      await recordIucnSync(ctx.db, species.group_id, "api_error", undefined, "Error 2");
      await recordIucnSync(ctx.db, species.group_id, "success", { category: "EN" });

      const logs = await getIucnSyncLog(ctx.db, species.group_id);

      assert.strictEqual(logs.length, 3);
      // Check we got all three statuses (any order is fine, we just need all of them)
      const statuses = logs.map((l) => l.status).sort();
      assert.deepStrictEqual(statuses, ["api_error", "api_error", "success"]);
      // Verify they're all for the same species
      assert.ok(logs.every((l) => l.group_id === species.group_id));
    });

    void test("should return all logs when no group_id specified", async () => {
      const species1 = await createTestSpeciesName(
        ctx.db,
        "Species 1",
        "Species one",
        "Species",
        "one",
        "Test"
      );
      const species2 = await createTestSpeciesName(
        ctx.db,
        "Species 2",
        "Species two",
        "Species",
        "two",
        "Test"
      );

      await recordIucnSync(ctx.db, species1.group_id, "success", { category: "VU" });
      await recordIucnSync(ctx.db, species2.group_id, "not_found");

      const logs = await getIucnSyncLog(ctx.db);

      assert.strictEqual(logs.length, 2);
    });

    void test("should respect limit parameter", async () => {
      const species = await createTestSpeciesName(
        ctx.db,
        "Limit Test",
        "Limitus testus",
        "Limitus",
        "testus",
        "Test"
      );

      // Create 5 sync attempts
      for (let i = 0; i < 5; i++) {
        await recordIucnSync(ctx.db, species.group_id, "success", { category: "VU" });
      }

      const logs = await getIucnSyncLog(ctx.db, species.group_id, 3);

      assert.strictEqual(logs.length, 3);
    });
  });

  void describe("getSpeciesWithMissingIucn", () => {
    void test("should return species without IUCN data", async () => {
      // Species with IUCN data
      const species1 = await createTestSpeciesName(
        ctx.db,
        "Has IUCN",
        "Hasus iucnus",
        "Hasus",
        "iucnus",
        "Test"
      );
      await updateIucnData(ctx.db, species1.group_id, { category: "VU" });

      // Species without IUCN data
      const species2 = await createTestSpeciesName(
        ctx.db,
        "No IUCN",
        "Nohasus iucnus",
        "Nohasus",
        "iucnus",
        "Test"
      );

      const missing = await getSpeciesWithMissingIucn(ctx.db);

      assert.ok(missing.length >= 1);
      const found = missing.find((s) => s.group_id === species2.group_id);
      assert.ok(found);
      assert.strictEqual(found.canonical_genus, "Nohasus");
      assert.strictEqual(found.canonical_species_name, "iucnus");
    });

    void test("should not return species with IUCN data", async () => {
      const species = await createTestSpeciesName(
        ctx.db,
        "Has Data",
        "Hasdata species",
        "Hasdata",
        "species",
        "Test"
      );
      await updateIucnData(ctx.db, species.group_id, { category: "EN" });

      const missing = await getSpeciesWithMissingIucn(ctx.db);

      const found = missing.find((s) => s.group_id === species.group_id);
      assert.strictEqual(found, undefined);
    });
  });

  void describe("getSpeciesNeedingResync", () => {
    void test("should return species with old IUCN data", async () => {
      const species = await createTestSpeciesName(
        ctx.db,
        "Old Data",
        "Oldus datus",
        "Oldus",
        "datus",
        "Test"
      );

      // Set IUCN data with old timestamp (400 days ago)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 400);

      await ctx.db.run(
        `UPDATE species_name_group
         SET iucn_redlist_category = 'VU',
             iucn_last_updated = ?
         WHERE group_id = ?`,
        [oldDate.toISOString(), species.group_id]
      );

      const needResync = await getSpeciesNeedingResync(ctx.db, 365); // Older than 1 year

      const found = needResync.find((s) => s.group_id === species.group_id);
      assert.ok(found);
      assert.strictEqual(found.iucn_redlist_category, "VU");
    });

    void test("should not return recently synced species", async () => {
      const species = await createTestSpeciesName(
        ctx.db,
        "Recent Data",
        "Recentus datus",
        "Recentus",
        "datus",
        "Test"
      );

      await updateIucnData(ctx.db, species.group_id, { category: "EN" });

      const needResync = await getSpeciesNeedingResync(ctx.db, 365);

      const found = needResync.find((s) => s.group_id === species.group_id);
      assert.strictEqual(found, undefined);
    });
  });

  void describe("getIucnSyncStats", () => {
    void test("should return accurate sync statistics", async () => {
      const species1 = await createTestSpeciesName(
        ctx.db,
        "Success 1",
        "Successus one",
        "Successus",
        "one",
        "Test"
      );
      const species2 = await createTestSpeciesName(
        ctx.db,
        "Success 2",
        "Successus two",
        "Successus",
        "two",
        "Test"
      );
      const species3 = await createTestSpeciesName(
        ctx.db,
        "Not Found",
        "Notfoundus species",
        "Notfoundus",
        "species",
        "Test"
      );
      const species4 = await createTestSpeciesName(
        ctx.db,
        "Error",
        "Errorus species",
        "Errorus",
        "species",
        "Test"
      );

      await recordIucnSync(ctx.db, species1.group_id, "success", { category: "VU" });
      await recordIucnSync(ctx.db, species2.group_id, "success", { category: "EN" });
      await recordIucnSync(ctx.db, species3.group_id, "not_found");
      await recordIucnSync(ctx.db, species4.group_id, "api_error", undefined, "Timeout");

      const stats = await getIucnSyncStats(ctx.db);

      assert.strictEqual(stats.total_syncs, 4);
      assert.strictEqual(stats.successful_syncs, 2);
      assert.strictEqual(stats.not_found_count, 1);
      assert.strictEqual(stats.error_count, 1);
      assert.ok(stats.last_sync_date); // Should have a date
    });

    void test("should return zero stats for empty database", async () => {
      const stats = await getIucnSyncStats(ctx.db);

      assert.strictEqual(stats.total_syncs, 0);
      assert.strictEqual(stats.successful_syncs, 0);
      assert.strictEqual(stats.not_found_count, 0);
      assert.strictEqual(stats.error_count, 0);
      assert.strictEqual(stats.last_sync_date, null);
    });
  });

  void describe("Integration: Update and Sync together", () => {
    void test("should update species and log sync in one operation", async () => {
      const species = await createTestSpeciesName(
        ctx.db,
        "Integration Test",
        "Integrus testus",
        "Integrus",
        "testus",
        "Test"
      );

      const iucnData: IUCNData = {
        category: "CR",
        taxonId: 789,
        populationTrend: "Stable",
      };

      // Update data
      await updateIucnData(ctx.db, species.group_id, iucnData);

      // Log sync
      await recordIucnSync(ctx.db, species.group_id, "success", iucnData);

      // Verify species data
      const speciesData = await ctx.db.get(
        `SELECT iucn_redlist_category, iucn_redlist_id, iucn_population_trend
         FROM species_name_group WHERE group_id = ?`,
        [species.group_id]
      );

      assert.strictEqual(speciesData.iucn_redlist_category, "CR");
      assert.strictEqual(speciesData.iucn_redlist_id, 789);
      assert.strictEqual(speciesData.iucn_population_trend, "Stable");

      // Verify sync log
      const syncLog = await ctx.db.get(
        `SELECT * FROM iucn_sync_log WHERE group_id = ?`,
        [species.group_id]
      );

      assert.strictEqual(syncLog.status, "success");
      assert.strictEqual(syncLog.category_found, "CR");
    });
  });

  void describe("Data constraints", () => {
    void test("should reject invalid IUCN category", async () => {
      const species = await createTestSpeciesName(
        ctx.db,
        "Invalid Category",
        "Invalidus category",
        "Invalidus",
        "category",
        "Test"
      );

      // Try to update with invalid category
      await assert.rejects(
        async () => {
          await ctx.db.run(
            `UPDATE species_name_group
             SET iucn_redlist_category = ?
             WHERE group_id = ?`,
            ["INVALID", species.group_id]
          );
        },
        /CHECK constraint failed/
      );
    });

    void test("should reject invalid population trend", async () => {
      const species = await createTestSpeciesName(
        ctx.db,
        "Invalid Trend",
        "Invalidus trend",
        "Invalidus",
        "trend",
        "Test"
      );

      await assert.rejects(
        async () => {
          await ctx.db.run(
            `UPDATE species_name_group
             SET iucn_population_trend = ?
             WHERE group_id = ?`,
            ["Invalid", species.group_id]
          );
        },
        /CHECK constraint failed/
      );
    });
  });
});
