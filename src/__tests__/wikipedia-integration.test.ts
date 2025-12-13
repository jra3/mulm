import { describe, test } from "node:test";
import assert from "node:assert";
import { getWikipediaClient } from "../integrations/wikipedia";

/**
 * Integration tests for Wikipedia/Wikidata client
 *
 * These tests make REAL API calls to Wikipedia/Wikidata APIs.
 * Run with: npm test -- src/__tests__/wikipedia-integration.test.ts
 *
 * Note: Tests are conservative with rate limiting to be respectful to APIs.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

void describe("Wikipedia Integration", () => {
  void describe("getExternalData", () => {
    void test("should find data for Poecilia reticulata (guppy)", async () => {
      const client = getWikipediaClient();
      const result = await client.getExternalData("Poecilia", "reticulata");

      assert.strictEqual(result.found, true, "Should find guppy");
      assert.ok(result.wikidata_id, "Should have Wikidata ID");
      assert.ok(result.wikipedia_url, "Should have Wikipedia URL");
      assert.ok(result.images && result.images.length > 0, "Should have images");

      // Verify image structure
      const firstImage = result.images![0];
      assert.ok(firstImage.url, "Image should have URL");
      assert.ok(firstImage.url.startsWith("https://"), "Image URL should be HTTPS");

      await sleep(150); // Rate limiting
    });

    void test("should find data for Danio rerio (zebrafish)", async () => {
      const client = getWikipediaClient();
      const result = await client.getExternalData("Danio", "rerio");

      assert.strictEqual(result.found, true, "Should find zebrafish");
      assert.ok(result.wikidata_id, "Should have Wikidata ID");
      assert.ok(result.wikipedia_url, "Should have Wikipedia URL");
      assert.ok(result.images && result.images.length > 0, "Should have images");

      await sleep(150);
    });

    void test("should find data for Acropora cervicornis (coral)", async () => {
      const client = getWikipediaClient();
      const result = await client.getExternalData("Acropora", "cervicornis");

      assert.strictEqual(result.found, true, "Should find coral");
      assert.ok(result.wikidata_id, "Should have Wikidata ID");
      // Corals may or may not have Wikipedia articles, but should have Wikidata entry

      await sleep(150);
    });

    void test("should find data for Neocaridina davidi (cherry shrimp)", async () => {
      const client = getWikipediaClient();
      const result = await client.getExternalData("Neocaridina", "davidi");

      assert.strictEqual(result.found, true, "Should find cherry shrimp");
      assert.ok(result.wikidata_id, "Should have Wikidata ID");

      await sleep(150);
    });

    void test("should handle species not in Wikidata", async () => {
      const client = getWikipediaClient();
      const result = await client.getExternalData("Nonexistus", "fictionalus");

      assert.strictEqual(result.found, false, "Should not find fictional species");
      assert.strictEqual(result.wikidata_id, undefined, "Should have no Wikidata ID");
      assert.strictEqual(result.wikipedia_url, undefined, "Should have no Wikipedia URL");
      assert.strictEqual(result.images, undefined, "Should have no images");

      await sleep(150);
    });

    void test("should return images with proper metadata", async () => {
      const client = getWikipediaClient();
      const result = await client.getExternalData("Betta", "splendens");

      assert.strictEqual(result.found, true, "Should find betta");

      if (result.images && result.images.length > 0) {
        const image = result.images[0];

        // Verify image structure
        assert.ok(image.url, "Should have URL");
        assert.ok(image.url.startsWith("https://"), "URL should be HTTPS");

        // Optional fields
        if (image.attribution) {
          assert.strictEqual(typeof image.attribution, "string");
        }
        if (image.license) {
          assert.strictEqual(typeof image.license, "string");
        }
      }

      await sleep(150);
    });

    void test("should handle genus-only lookup gracefully", async () => {
      const client = getWikipediaClient();
      const result = await client.getExternalData("Poecilia", "");

      // Should either find something or return not found, but shouldn't error
      assert.strictEqual(typeof result.found, "boolean");

      await sleep(150);
    });

    void test("should handle special characters in species names", async () => {
      const client = getWikipediaClient();
      const result = await client.getExternalData("Corydoras", "paleatus");

      assert.strictEqual(result.found, true, "Should find Corydoras paleatus");
      assert.ok(result.wikidata_id, "Should have Wikidata ID");

      await sleep(150);
    });
  });

  void describe("Rate limiting and performance", () => {
    void test("should complete lookup within reasonable time", async () => {
      const startTime = Date.now();

      const client = getWikipediaClient();
      await client.getExternalData("Poecilia", "reticulata");

      const duration = Date.now() - startTime;

      // Should complete within 5 seconds
      assert.ok(duration < 5000, `Lookup took ${duration}ms, should be < 5000ms`);

      await sleep(150);
    });

    void test("should handle multiple sequential lookups", async () => {
      const client = getWikipediaClient();
      const species = [
        { genus: "Poecilia", species: "reticulata" },
        { genus: "Danio", species: "rerio" },
        { genus: "Betta", species: "splendens" },
      ];

      for (const s of species) {
        const result = await client.getExternalData(s.genus, s.species);
        assert.strictEqual(result.found, true, `Should find ${s.genus} ${s.species}`);
        await sleep(150); // Rate limiting between requests
      }
    });
  });

  void describe("Error handling", () => {
    void test("should handle malformed species names", async () => {
      const client = getWikipediaClient();

      // Test with various malformed inputs
      const result1 = await client.getExternalData("", "");
      assert.strictEqual(result1.found, false);
      await sleep(150);

      const result2 = await client.getExternalData("  ", "  ");
      assert.strictEqual(result2.found, false);
      await sleep(150);
    });

    void test("should handle very long species names", async () => {
      const client = getWikipediaClient();
      const longGenus = "A".repeat(100);
      const longSpecies = "b".repeat(100);

      const result = await client.getExternalData(longGenus, longSpecies);

      // Should not crash, just return not found
      assert.strictEqual(result.found, false);

      await sleep(150);
    });
  });
});
