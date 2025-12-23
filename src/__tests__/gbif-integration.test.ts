import { describe, test } from "node:test";
import assert from "node:assert";
import { getGBIFClient } from "../integrations/gbif";
import config from "@/config.json";

/**
 * Integration tests for GBIF (Global Biodiversity Information Facility) client
 *
 * These tests make REAL API calls to GBIF API.
 * Run with: npm test -- src/__tests__/gbif-integration.test.ts
 *
 * Note: Tests are conservative with rate limiting to be respectful to GBIF.
 * Tests are skipped in CI (NODE_ENV=test) or when GBIF sync is disabled.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Skip these tests in CI as they require real API calls
const skipReason = !config.gbif?.enableSync
  ? "GBIF integration is disabled"
  : process.env.CI
    ? "Skipping external API tests in CI"
    : undefined;

void describe("GBIF Integration", { skip: skipReason }, () => {
  void describe("getExternalData", () => {
    void test("should find data for Poecilia reticulata (guppy)", async () => {
      const client = getGBIFClient();
      const result = await client.getExternalData("Poecilia", "reticulata");

      assert.strictEqual(result.found, true, "Should find guppy");
      assert.ok(result.gbif_id, "Should have GBIF usage key");
      assert.ok(result.species_url, "Should have species URL");
      assert.ok(result.species_url.includes("gbif.org"), "URL should be GBIF domain");

      await sleep(120);
    });

    void test("should find data for common fish species", async () => {
      const client = getGBIFClient();
      const result = await client.getExternalData("Danio", "rerio");

      assert.strictEqual(result.found, true);
      assert.ok(result.gbif_id);

      await sleep(120);
    });

    void test("should handle species not in GBIF", async () => {
      const client = getGBIFClient();
      const result = await client.getExternalData("Nonexistus", "fictionalus");

      assert.strictEqual(result.found, false);

      await sleep(120);
    });
  });
});
