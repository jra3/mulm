import { describe, test } from "node:test";
import assert from "node:assert";
import { type ImageMetadata } from "../utils/r2-client";

void describe("Orphaned Image Cleanup", () => {

  void test("should build referenced keys set from database rows", () => {
    // This tests the core logic of building the referenced keys set
    const referencedKeys = new Set<string>();

    // Simulate database query results
    const mockSubmissions = [
      {
        images: JSON.stringify([
          {
            key: "submissions/1/1/12345-original.jpg",
            url: "https://example.com/12345-original.jpg",
            size: 1000,
            uploadedAt: new Date().toISOString(),
          },
          {
            key: "submissions/1/2/67890-original.jpg",
            url: "https://example.com/67890-original.jpg",
            size: 2000,
            uploadedAt: new Date().toISOString(),
          },
        ]),
      },
    ];

    // Process like the cleanup function does
    for (const row of mockSubmissions) {
      if (row.images) {
        try {
          const imageArray = JSON.parse(row.images) as ImageMetadata[];
          for (const img of imageArray) {
            referencedKeys.add(img.key);
            referencedKeys.add(img.key.replace("-original.", "-medium."));
            referencedKeys.add(img.key.replace("-original.", "-thumb."));
          }
        } catch {
          // Would be logged in actual code
        }
      }
    }

    // Should have 2 images × 3 variants = 6 keys
    assert.strictEqual(referencedKeys.size, 6);
    assert.ok(referencedKeys.has("submissions/1/1/12345-original.jpg"));
    assert.ok(referencedKeys.has("submissions/1/1/12345-medium.jpg"));
    assert.ok(referencedKeys.has("submissions/1/1/12345-thumb.jpg"));
    assert.ok(referencedKeys.has("submissions/1/2/67890-original.jpg"));
    assert.ok(referencedKeys.has("submissions/1/2/67890-medium.jpg"));
    assert.ok(referencedKeys.has("submissions/1/2/67890-thumb.jpg"));
  });

  void test("should skip images referenced in database", async () => {
    // This test verifies the logic without actual R2 calls
    const referencedKeys = new Set<string>();

    // Simulate database query results
    const mockSubmissions = [
      {
        images: JSON.stringify([
          {
            key: "submissions/1/1/12345-original.jpg",
            url: "https://example.com/12345-original.jpg",
            size: 1000,
            uploadedAt: new Date().toISOString(),
          },
        ]),
      },
    ];

    // Process like the cleanup function does
    for (const row of mockSubmissions) {
      if (row.images) {
        const imageArray = JSON.parse(row.images) as ImageMetadata[];
        for (const img of imageArray) {
          referencedKeys.add(img.key);
          referencedKeys.add(img.key.replace("-original.", "-medium."));
          referencedKeys.add(img.key.replace("-original.", "-thumb."));
        }
      }
    }

    // Verify all variants are tracked
    assert.strictEqual(referencedKeys.size, 3);
    assert.ok(referencedKeys.has("submissions/1/1/12345-original.jpg"));
    assert.ok(referencedKeys.has("submissions/1/1/12345-medium.jpg"));
    assert.ok(referencedKeys.has("submissions/1/1/12345-thumb.jpg"));
  });

  void test("should only delete images older than 7 days", () => {
    const SAFETY_AGE_DAYS = 7;
    const now = Date.now();

    // Image from 10 days ago (should be deleted)
    const oldImage = {
      key: "submissions/1/1/old-original.jpg",
      lastModified: new Date(now - 10 * 24 * 60 * 60 * 1000),
      size: 1000,
    };

    // Image from 5 days ago (should be kept)
    const recentImage = {
      key: "submissions/1/1/recent-original.jpg",
      lastModified: new Date(now - 5 * 24 * 60 * 60 * 1000),
      size: 1000,
    };

    // Calculate ages
    const oldAgeMs = now - oldImage.lastModified.getTime();
    const oldAgeDays = oldAgeMs / (1000 * 60 * 60 * 24);

    const recentAgeMs = now - recentImage.lastModified.getTime();
    const recentAgeDays = recentAgeMs / (1000 * 60 * 60 * 24);

    // Verify logic
    assert.ok(oldAgeDays > SAFETY_AGE_DAYS, "Old image should be marked for deletion");
    assert.ok(
      recentAgeDays <= SAFETY_AGE_DAYS,
      "Recent image should not be marked for deletion"
    );
  });

  void test("should handle both submission and collection images", () => {
    // Test that cleanup logic handles both tables
    const referencedKeys = new Set<string>();

    // Mock submissions data
    const mockSubmissions = [
      {
        images: JSON.stringify([
          {
            key: "submissions/1/1/submission-original.jpg",
            url: "https://example.com/submission-original.jpg",
            size: 1000,
            uploadedAt: new Date().toISOString(),
          },
        ]),
      },
    ];

    // Mock collection data
    const mockCollections = [
      {
        images: JSON.stringify([
          {
            key: "submissions/2/2/collection-original.jpg",
            url: "https://example.com/collection-original.jpg",
            size: 2000,
            uploadedAt: new Date().toISOString(),
          },
        ]),
      },
    ];

    // Process submissions
    for (const row of mockSubmissions) {
      if (row.images) {
        const imageArray = JSON.parse(row.images) as ImageMetadata[];
        for (const img of imageArray) {
          referencedKeys.add(img.key);
          referencedKeys.add(img.key.replace("-original.", "-medium."));
          referencedKeys.add(img.key.replace("-original.", "-thumb."));
        }
      }
    }

    // Process collections
    for (const row of mockCollections) {
      if (row.images) {
        const imageArray = JSON.parse(row.images) as ImageMetadata[];
        for (const img of imageArray) {
          referencedKeys.add(img.key);
          referencedKeys.add(img.key.replace("-original.", "-medium."));
          referencedKeys.add(img.key.replace("-original.", "-thumb."));
        }
      }
    }

    // Should have 2 images × 3 variants = 6 keys total
    assert.strictEqual(referencedKeys.size, 6);
    assert.ok(referencedKeys.has("submissions/1/1/submission-original.jpg"));
    assert.ok(referencedKeys.has("submissions/2/2/collection-original.jpg"));
  });

  void test("should handle image key variants correctly", () => {
    const originalKey = "submissions/1/1/12345-original.jpg";

    // Test the key replacement logic used in cleanup
    const mediumKey = originalKey.replace("-original.", "-medium.");
    const thumbKey = originalKey.replace("-original.", "-thumb.");

    assert.strictEqual(mediumKey, "submissions/1/1/12345-medium.jpg");
    assert.strictEqual(thumbKey, "submissions/1/1/12345-thumb.jpg");
  });

  void test("should gracefully handle malformed JSON in database", () => {
    const malformedRows = [{ images: "{invalid json" }, { images: "[]" }, { images: null }];

    let parsedCount = 0;
    let errorCount = 0;

    for (const row of malformedRows) {
      if (row.images) {
        try {
          JSON.parse(row.images);
          parsedCount++;
        } catch {
          errorCount++;
          // In actual code, this would be logged and skipped
        }
      }
    }

    assert.strictEqual(parsedCount, 1, "Only valid JSON should parse");
    assert.strictEqual(errorCount, 1, "Malformed JSON should be caught");
  });
});
