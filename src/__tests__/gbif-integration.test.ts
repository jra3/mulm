import { describe, test } from "node:test";
import assert from "node:assert";
import { getGBIFClient } from "../integrations/gbif";
import config from "@/config.json";
import { skipUnlessExternalTestsEnabled } from "./helpers/externalTests";

/**
 * Integration tests for GBIF (Global Biodiversity Information Facility) client
 *
 * These tests make REAL API calls to GBIF API, and run only when
 * RUN_EXTERNAL_TESTS is set and GBIF sync is enabled in config
 * (see helpers/externalTests.ts): `npm run test:external`.
 *
 * `getExternalData` returns a GBIFResult, or null when GBIF has no confident
 * match. The client rate-limits its own requests.
 */

const skipReason = skipUnlessExternalTestsEnabled("GBIF", config.gbif?.enableSync);

void describe("GBIF Integration", { skip: skipReason }, () => {
  void describe("getExternalData", () => {
    void test("finds Poecilia reticulata (guppy)", async () => {
      const result = await getGBIFClient().getExternalData("Poecilia", "reticulata");

      assert.ok(result, "Should find guppy");
      assert.ok(result.usageKey > 0, "Should have a GBIF usage key");
      assert.strictEqual(result.gbifUrl, `https://www.gbif.org/species/${result.usageKey}`);
      assert.ok(
        result.occurrenceMapUrl.includes(`taxonKey=${result.usageKey}`),
        "Occurrence map should be for this taxon"
      );
      assert.strictEqual(result.scientificName, "Poecilia reticulata");
      assert.ok(result.confidence >= 80, "Only confident matches are returned");
      assert.ok(Array.isArray(result.imageUrls));
      for (const url of result.imageUrls) {
        assert.ok(url.startsWith("http"), `Image URL should be absolute: ${url}`);
      }
    });

    void test("finds Danio rerio (zebrafish)", async () => {
      const result = await getGBIFClient().getExternalData("Danio", "rerio");

      assert.ok(result, "Should find zebrafish");
      assert.strictEqual(result.scientificName, "Danio rerio");
    });

    void test("returns null for a species not in GBIF", async () => {
      const result = await getGBIFClient().getExternalData("Nonexistus", "fictionalus");

      assert.strictEqual(result, null);
    });
  });
});
