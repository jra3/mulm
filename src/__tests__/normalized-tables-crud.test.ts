import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import {
  getSubmissionImages,
  addSubmissionImage,
  deleteSubmissionImage,
  getSubmissionSupplements,
  setSubmissionSupplements,
} from "../db/submissions";
import {
  getSpeciesExternalReferences,
  setSpeciesExternalReferences,
  getSpeciesImages,
  setSpeciesImages,
} from "../db/species";

void describe("Normalized Tables CRUD Operations", () => {
  let db: Database;
  let testSubmissionId: number;
  let testSpeciesGroupId: number;

  beforeEach(async () => {
    db = await open({
      filename: ":memory:",
      driver: sqlite3.Database,
    });

    await db.exec("PRAGMA foreign_keys = ON;");
    await db.migrate({ migrationsPath: "./db/migrations" });
    overrideConnection(db);

    // Create test member
    const memberResult = await db.run(
      "INSERT INTO members (contact_email, display_name) VALUES (?, ?)",
      ["test@example.com", "Test User"]
    );
    const memberId = memberResult.lastID as number;

    // Create test submission
    const submissionResult = await db.run(
      `INSERT INTO submissions (
        member_id, species_class, species_type, species_common_name,
        species_latin_name, reproduction_date, temperature, ph, gh,
        specific_gravity, water_type, witness_verification_status,
        program, submitted_on
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        memberId,
        "Livebearers",
        "Fish",
        "Test Fish",
        "Testus fishus",
        new Date().toISOString(),
        "75",
        "7.0",
        "10",
        "1.000",
        "Fresh",
        "pending",
        "fish",
        new Date().toISOString(),
      ]
    );
    testSubmissionId = submissionResult.lastID as number;

    // Create test species group
    const speciesResult = await db.run(
      `INSERT INTO species_name_group (
        program_class, species_type, canonical_genus, canonical_species_name
      ) VALUES (?, ?, ?, ?)`,
      ["Livebearers", "Fish", "Testgenus", "testspecies"]
    );
    testSpeciesGroupId = speciesResult.lastID as number;
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  // ============================================================================
  // submission_images tests
  // ============================================================================

  void describe("submission_images CRUD", () => {
    void test("should add and retrieve submission images", async () => {
      // Add first image
      const imageId1 = await addSubmissionImage(testSubmissionId, {
        r2_key: "submissions/1/1/image1.jpg",
        public_url: "https://example.com/image1.jpg",
        file_size: 1000,
        uploaded_at: new Date().toISOString(),
        content_type: "image/jpeg",
      });

      assert.ok(imageId1 > 0, "Should return positive image ID");

      // Add second image
      const imageId2 = await addSubmissionImage(testSubmissionId, {
        r2_key: "submissions/1/1/image2.jpg",
        public_url: "https://example.com/image2.jpg",
        file_size: 2000,
        uploaded_at: new Date().toISOString(),
        content_type: "image/png",
      });

      assert.ok(imageId2 > imageId1, "Second image ID should be greater");

      // Retrieve images
      const images = await getSubmissionImages(testSubmissionId);

      assert.strictEqual(images.length, 2, "Should have 2 images");
      assert.strictEqual(images[0].r2_key, "submissions/1/1/image1.jpg");
      assert.strictEqual(images[0].file_size, 1000);
      assert.strictEqual(images[0].display_order, 0);
      assert.strictEqual(images[1].r2_key, "submissions/1/1/image2.jpg");
      assert.strictEqual(images[1].file_size, 2000);
      assert.strictEqual(images[1].display_order, 1);
    });

    void test("should respect display order when adding images", async () => {
      // Add 3 images
      await addSubmissionImage(testSubmissionId, {
        r2_key: "image1.jpg",
        public_url: "https://example.com/1.jpg",
        file_size: 100,
        uploaded_at: new Date().toISOString(),
        content_type: "image/jpeg",
      });

      await addSubmissionImage(testSubmissionId, {
        r2_key: "image2.jpg",
        public_url: "https://example.com/2.jpg",
        file_size: 200,
        uploaded_at: new Date().toISOString(),
        content_type: "image/jpeg",
      });

      await addSubmissionImage(testSubmissionId, {
        r2_key: "image3.jpg",
        public_url: "https://example.com/3.jpg",
        file_size: 300,
        uploaded_at: new Date().toISOString(),
        content_type: "image/jpeg",
      });

      const images = await getSubmissionImages(testSubmissionId);

      assert.strictEqual(images[0].display_order, 0);
      assert.strictEqual(images[1].display_order, 1);
      assert.strictEqual(images[2].display_order, 2);
    });

    void test("should delete submission image by key", async () => {
      // Add 2 images
      await addSubmissionImage(testSubmissionId, {
        r2_key: "keep.jpg",
        public_url: "https://example.com/keep.jpg",
        file_size: 100,
        uploaded_at: new Date().toISOString(),
        content_type: "image/jpeg",
      });

      await addSubmissionImage(testSubmissionId, {
        r2_key: "delete.jpg",
        public_url: "https://example.com/delete.jpg",
        file_size: 200,
        uploaded_at: new Date().toISOString(),
        content_type: "image/jpeg",
      });

      // Delete one
      await deleteSubmissionImage(testSubmissionId, "delete.jpg");

      // Verify only one remains
      const images = await getSubmissionImages(testSubmissionId);
      assert.strictEqual(images.length, 1);
      assert.strictEqual(images[0].r2_key, "keep.jpg");
    });

    void test("should return empty array for submission with no images", async () => {
      const images = await getSubmissionImages(testSubmissionId);
      assert.strictEqual(images.length, 0);
    });

    void test("should enforce unique constraint on submission_id + r2_key", async () => {
      await addSubmissionImage(testSubmissionId, {
        r2_key: "duplicate.jpg",
        public_url: "https://example.com/dup.jpg",
        file_size: 100,
        uploaded_at: new Date().toISOString(),
        content_type: "image/jpeg",
      });

      // Try to add same key again
      await assert.rejects(
        async () => {
          await addSubmissionImage(testSubmissionId, {
            r2_key: "duplicate.jpg",
            public_url: "https://example.com/dup.jpg",
            file_size: 100,
            uploaded_at: new Date().toISOString(),
            content_type: "image/jpeg",
          });
        },
        /UNIQUE constraint failed/,
        "Should reject duplicate r2_key for same submission"
      );
    });

    void test("should cascade delete images when submission deleted", async () => {
      await addSubmissionImage(testSubmissionId, {
        r2_key: "test.jpg",
        public_url: "https://example.com/test.jpg",
        file_size: 100,
        uploaded_at: new Date().toISOString(),
        content_type: "image/jpeg",
      });

      // Delete submission
      await db.run("DELETE FROM submissions WHERE id = ?", testSubmissionId);

      // Verify images cascade deleted
      const images = await getSubmissionImages(testSubmissionId);
      assert.strictEqual(images.length, 0);
    });
  });

  // ============================================================================
  // submission_supplements tests
  // ============================================================================

  void describe("submission_supplements CRUD", () => {
    void test("should set and retrieve submission supplements", async () => {
      await setSubmissionSupplements(testSubmissionId, [
        { type: "Flourish", regimen: "1ml weekly" },
        { type: "Excel", regimen: "2ml daily" },
      ]);

      const supplements = await getSubmissionSupplements(testSubmissionId);

      assert.strictEqual(supplements.length, 2);
      assert.strictEqual(supplements[0].supplement_type, "Flourish");
      assert.strictEqual(supplements[0].supplement_regimen, "1ml weekly");
      assert.strictEqual(supplements[0].display_order, 0);
      assert.strictEqual(supplements[1].supplement_type, "Excel");
      assert.strictEqual(supplements[1].supplement_regimen, "2ml daily");
      assert.strictEqual(supplements[1].display_order, 1);
    });

    void test("should replace all supplements when set is called again", async () => {
      // Set initial supplements
      await setSubmissionSupplements(testSubmissionId, [
        { type: "Old1", regimen: "Old regimen 1" },
        { type: "Old2", regimen: "Old regimen 2" },
      ]);

      // Replace with new supplements
      await setSubmissionSupplements(testSubmissionId, [
        { type: "New1", regimen: "New regimen 1" },
      ]);

      const supplements = await getSubmissionSupplements(testSubmissionId);

      assert.strictEqual(supplements.length, 1);
      assert.strictEqual(supplements[0].supplement_type, "New1");
    });

    void test("should handle empty supplements array", async () => {
      // Set some supplements first
      await setSubmissionSupplements(testSubmissionId, [
        { type: "Test", regimen: "Test regimen" },
      ]);

      // Clear them
      await setSubmissionSupplements(testSubmissionId, []);

      const supplements = await getSubmissionSupplements(testSubmissionId);
      assert.strictEqual(supplements.length, 0);
    });

    void test("should skip supplements with empty type and regimen", async () => {
      await setSubmissionSupplements(testSubmissionId, [
        { type: "Valid", regimen: "Valid regimen" },
        { type: "", regimen: "" }, // Should be skipped
        { type: "Also valid", regimen: "Another regimen" },
      ]);

      const supplements = await getSubmissionSupplements(testSubmissionId);
      assert.strictEqual(supplements.length, 2);
    });

    void test("should preserve display order", async () => {
      await setSubmissionSupplements(testSubmissionId, [
        { type: "First", regimen: "1" },
        { type: "Second", regimen: "2" },
        { type: "Third", regimen: "3" },
      ]);

      const supplements = await getSubmissionSupplements(testSubmissionId);

      assert.strictEqual(supplements[0].display_order, 0);
      assert.strictEqual(supplements[1].display_order, 1);
      assert.strictEqual(supplements[2].display_order, 2);
    });

    void test("should cascade delete supplements when submission deleted", async () => {
      await setSubmissionSupplements(testSubmissionId, [
        { type: "Test", regimen: "Test regimen" },
      ]);

      // Delete submission
      await db.run("DELETE FROM submissions WHERE id = ?", testSubmissionId);

      // Verify supplements cascade deleted
      const supplements = await getSubmissionSupplements(testSubmissionId);
      assert.strictEqual(supplements.length, 0);
    });
  });

  // ============================================================================
  // species_external_references tests
  // ============================================================================

  void describe("species_external_references CRUD", () => {
    void test("should set and retrieve external references", async () => {
      await setSpeciesExternalReferences(testSpeciesGroupId, [
        "https://fishbase.org/species1",
        "https://example.com/reference2",
      ]);

      const refs = await getSpeciesExternalReferences(testSpeciesGroupId);

      assert.strictEqual(refs.length, 2);
      assert.strictEqual(refs[0].reference_url, "https://fishbase.org/species1");
      assert.strictEqual(refs[0].display_order, 0);
      assert.strictEqual(refs[1].reference_url, "https://example.com/reference2");
      assert.strictEqual(refs[1].display_order, 1);
    });

    void test("should replace all references when set is called again", async () => {
      await setSpeciesExternalReferences(testSpeciesGroupId, [
        "https://old1.com",
        "https://old2.com",
      ]);

      await setSpeciesExternalReferences(testSpeciesGroupId, ["https://new.com"]);

      const refs = await getSpeciesExternalReferences(testSpeciesGroupId);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].reference_url, "https://new.com");
    });

    void test("should handle empty references array", async () => {
      await setSpeciesExternalReferences(testSpeciesGroupId, ["https://test.com"]);

      await setSpeciesExternalReferences(testSpeciesGroupId, []);

      const refs = await getSpeciesExternalReferences(testSpeciesGroupId);
      assert.strictEqual(refs.length, 0);
    });

    void test("should cascade delete references when species group deleted", async () => {
      await setSpeciesExternalReferences(testSpeciesGroupId, ["https://test.com"]);

      await db.run("DELETE FROM species_name_group WHERE group_id = ?", testSpeciesGroupId);

      const refs = await getSpeciesExternalReferences(testSpeciesGroupId);
      assert.strictEqual(refs.length, 0);
    });
  });

  // ============================================================================
  // species_images tests
  // ============================================================================

  void describe("species_images CRUD", () => {
    void test("should set and retrieve species images", async () => {
      await setSpeciesImages(testSpeciesGroupId, [
        "https://example.com/image1.jpg",
        "https://example.com/image2.jpg",
      ]);

      const images = await getSpeciesImages(testSpeciesGroupId);

      assert.strictEqual(images.length, 2);
      assert.strictEqual(images[0].image_url, "https://example.com/image1.jpg");
      assert.strictEqual(images[0].display_order, 0);
      assert.strictEqual(images[1].image_url, "https://example.com/image2.jpg");
      assert.strictEqual(images[1].display_order, 1);
    });

    void test("should replace all images when set is called again", async () => {
      await setSpeciesImages(testSpeciesGroupId, [
        "https://old1.com/img.jpg",
        "https://old2.com/img.jpg",
      ]);

      await setSpeciesImages(testSpeciesGroupId, ["https://new.com/img.jpg"]);

      const images = await getSpeciesImages(testSpeciesGroupId);

      assert.strictEqual(images.length, 1);
      assert.strictEqual(images[0].image_url, "https://new.com/img.jpg");
    });

    void test("should handle empty images array", async () => {
      await setSpeciesImages(testSpeciesGroupId, ["https://test.com/img.jpg"]);

      await setSpeciesImages(testSpeciesGroupId, []);

      const images = await getSpeciesImages(testSpeciesGroupId);
      assert.strictEqual(images.length, 0);
    });

    void test("should cascade delete images when species group deleted", async () => {
      await setSpeciesImages(testSpeciesGroupId, ["https://test.com/img.jpg"]);

      await db.run("DELETE FROM species_name_group WHERE group_id = ?", testSpeciesGroupId);

      const images = await getSpeciesImages(testSpeciesGroupId);
      assert.strictEqual(images.length, 0);
    });
  });
});
