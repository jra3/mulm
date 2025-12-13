import { describe, test, before } from "node:test";
import assert from "node:assert";
import { getFishBaseClient } from "../integrations/fishbase";
import { existsSync } from "fs";
import { join } from "path";

/**
 * Integration tests for FishBase client
 *
 * These tests query the local FishBase DuckDB/Parquet database.
 * Run with: npm test -- src/__tests__/fishbase-integration.test.ts
 *
 * Note: Requires FishBase Parquet files to be present in data/fishbase/
 */

// Check if FishBase data is available
const fishbaseDataPath = join(process.cwd(), "data", "fishbase");
const hasFishBaseData = existsSync(fishbaseDataPath);

void describe("FishBase Integration", () => {
  before(() => {
    if (!hasFishBaseData) {
      console.log("\n⚠️  FishBase data not found at data/fishbase/");
      console.log("   FishBase integration tests will be skipped");
      console.log("   To enable: Download FishBase Parquet files to data/fishbase/\n");
    }
  });

  void describe("getExternalData", () => {
    void test("should find data for Poecilia reticulata (guppy)", async (t) => {
      if (!hasFishBaseData) return t.skip("FishBase data not available");

      const client = getFishBaseClient();
      const result = await client.getExternalData("Poecilia", "reticulata");

      assert.strictEqual(result.found, true);
      assert.ok(result.species_url);
    });

    void test("should find data for common fish", async (t) => {
      if (!hasFishBaseData) return t.skip("FishBase data not available");

      const client = getFishBaseClient();
      const result = await client.getExternalData("Danio", "rerio");

      assert.strictEqual(result.found, true);
    });

    void test("should not find non-fish species", async (t) => {
      if (!hasFishBaseData) return t.skip("FishBase data not available");

      const client = getFishBaseClient();
      const result = await client.getExternalData("Acropora", "cervicornis");

      assert.strictEqual(result.found, false);
    });
  });
});
