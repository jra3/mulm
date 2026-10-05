import { describe, test } from "node:test";
import assert from "node:assert";
import { getWikipediaClient } from "../integrations/wikipedia";
import config from "@/config.json";
import { skipUnlessExternalTestsEnabled } from "./helpers/externalTests";

/**
 * Integration tests for Wikipedia/Wikidata client
 *
 * These tests make REAL API calls to Wikipedia/Wikidata APIs, and run only
 * when RUN_EXTERNAL_TESTS is set and Wikipedia sync is enabled in config
 * (see helpers/externalTests.ts): `npm run test:external`.
 *
 * `getExternalData` returns a WikipediaResult, or null when Wikidata has no
 * taxon by that exact name. The client rate-limits its own requests.
 */

const skipReason = skipUnlessExternalTestsEnabled("Wikipedia", config.wikipedia?.enableSync);

void describe("Wikipedia Integration", { skip: skipReason }, () => {
  void describe("getExternalData", () => {
    void test("finds Poecilia reticulata (guppy) with an article and images", async () => {
      const result = await getWikipediaClient().getExternalData("Poecilia", "reticulata");

      assert.ok(result, "Should find guppy");
      assert.match(result.wikidataId, /^Q\d+$/);
      assert.strictEqual(result.wikidataUrl, `http://www.wikidata.org/entity/${result.wikidataId}`);
      assert.ok(result.wikipediaUrls.en?.includes("wikipedia.org"), "Should have an English article");
      assert.ok(result.imageUrls.length > 0, "Should have images");
      for (const url of result.imageUrls) {
        assert.ok(url.startsWith("http"), `Image URL should be absolute: ${url}`);
      }
      assert.strictEqual(result.scientificName, "Poecilia reticulata");
    });

    for (const [genus, species, what] of [
      ["Danio", "rerio", "zebrafish"],
      ["Betta", "splendens", "betta"],
      ["Corydoras", "paleatus", "peppered cory"],
      ["Neocaridina", "davidi", "cherry shrimp"],
      ["Acropora", "cervicornis", "staghorn coral"],
    ] as const) {
      void test(`finds ${genus} ${species} (${what})`, async () => {
        const result = await getWikipediaClient().getExternalData(genus, species);

        assert.ok(result, `Should find ${what}`);
        assert.match(result.wikidataId, /^Q\d+$/);
      });
    }

    void test("returns null for a species not in Wikidata", async () => {
      const result = await getWikipediaClient().getExternalData("Nonexistus", "fictionalus");

      assert.strictEqual(result, null);
    });
  });

  void describe("Malformed names", () => {
    void test("returns null for empty and blank names", async () => {
      const client = getWikipediaClient();

      assert.strictEqual(await client.getExternalData("", ""), null);
      assert.strictEqual(await client.getExternalData("  ", "  "), null);
    });

    void test("returns null for very long names", async () => {
      const result = await getWikipediaClient().getExternalData("A".repeat(100), "b".repeat(100));

      assert.strictEqual(result, null);
    });
  });
});
