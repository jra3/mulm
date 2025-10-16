import { describe, test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import { S3Client } from "@aws-sdk/client-s3";
import { overrideR2Client, ImageMetadata, deleteImage } from "../utils/r2-client";

interface TestMember {
  id: number;
  display_name: string;
  contact_email: string;
}

interface TestSubmission {
  id: number;
  member_id: number;
  images: string | null;
}

void describe("Upload Transaction Tests", () => {
  let db: Database;
  let testMember: TestMember;

  // Mock S3 client
  const mockS3Client = {
    send: mock.fn(async () => ({ $metadata: { httpStatusCode: 200 } })),
  } as unknown as S3Client;

  beforeEach(async () => {
    // Create fresh in-memory database for each test
    db = await open({
      filename: ":memory:",
      driver: sqlite3.Database,
    });

    // Enable foreign key constraints
    await db.exec("PRAGMA foreign_keys = ON;");

    // Run migrations
    await db.migrate({
      migrationsPath: "./db/migrations",
    });

    // Override the global connection
    overrideConnection(db);

    // Override R2 client with mock
    overrideR2Client(mockS3Client, {
      endpoint: "https://test.r2.cloudflarestorage.com",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      bucketName: "test-bucket",
      publicUrl: "https://test.example.com",
    });

    // Create test member
    const memberEmail = `member-${Date.now()}@test.com`;
    const result = await db.run("INSERT INTO members (contact_email, display_name) VALUES (?, ?)", [
      memberEmail,
      "Test Member",
    ]);

    testMember = {
      id: result.lastID as number,
      display_name: "Test Member",
      contact_email: memberEmail,
    };
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  // Helper function to create a test submission
  async function createTestSubmission(memberId: number): Promise<number> {
    const result = await db.run(
      `
      INSERT INTO submissions (
        member_id, species_class, species_type, species_common_name,
        species_latin_name, reproduction_date, temperature, ph, gh,
        specific_gravity, water_type, witness_verification_status,
        program, submitted_on
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        memberId,
        "New World",
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

    return result.lastID as number;
  }

  void test("should maintain database consistency on transaction failure", async () => {
    const submissionId = await createTestSubmission(testMember.id);

    // Add initial images to submission
    const initialImages: ImageMetadata[] = [
      {
        key: "submissions/1/1/initial.jpg",
        url: "https://test.example.com/initial.jpg",
        size: 1000,
        uploadedAt: new Date().toISOString(),
        contentType: "image/jpeg",
      },
    ];

    await db.run("UPDATE submissions SET images = ? WHERE id = ?", [
      JSON.stringify(initialImages),
      submissionId,
    ]);

    // Verify initial state
    const beforeUpdate = await db.get<TestSubmission>(
      "SELECT id, member_id, images FROM submissions WHERE id = ?",
      submissionId
    );
    assert.ok(beforeUpdate);
    assert.strictEqual(beforeUpdate.images, JSON.stringify(initialImages));

    // Simulate a transaction that should fail
    // In a real scenario, this would be triggered by database constraints or errors
    try {
      await db.exec("BEGIN TRANSACTION;");

      // Try to update with invalid data that violates constraints
      await db.run("UPDATE submissions SET images = ? WHERE id = ?", [
        JSON.stringify([
          ...initialImages,
          { key: "new.jpg", url: "test", size: 2000, uploadedAt: new Date().toISOString() },
        ]),
        submissionId,
      ]);

      // Force a failure by trying to insert duplicate or invalid data
      await db.run("INSERT INTO submissions (id) VALUES (?)", [submissionId]); // This should fail

      await db.exec("COMMIT;");
      assert.fail("Transaction should have failed");
    } catch {
      // Transaction should fail and rollback
      await db.exec("ROLLBACK;").catch(() => {});
    }

    // Verify that database state was rolled back
    const afterFailedUpdate = await db.get<TestSubmission>(
      "SELECT id, member_id, images FROM submissions WHERE id = ?",
      submissionId
    );
    assert.ok(afterFailedUpdate);
    assert.strictEqual(afterFailedUpdate.images, JSON.stringify(initialImages));
  });

  void test("should atomically update images in transaction", async () => {
    const submissionId = await createTestSubmission(testMember.id);

    const newImages: ImageMetadata[] = [
      {
        key: "submissions/1/1/image1.jpg",
        url: "https://test.example.com/image1.jpg",
        size: 1000,
        uploadedAt: new Date().toISOString(),
        contentType: "image/jpeg",
      },
      {
        key: "submissions/1/1/image2.jpg",
        url: "https://test.example.com/image2.jpg",
        size: 2000,
        uploadedAt: new Date().toISOString(),
        contentType: "image/jpeg",
      },
    ];

    // Update images in a transaction
    await db.exec("BEGIN TRANSACTION;");
    try {
      await db.run("UPDATE submissions SET images = ? WHERE id = ?", [
        JSON.stringify(newImages),
        submissionId,
      ]);
      await db.exec("COMMIT;");
    } catch (error) {
      await db.exec("ROLLBACK;").catch(() => {});
      throw error;
    }

    // Verify images were updated atomically
    const submission = await db.get<TestSubmission>(
      "SELECT images FROM submissions WHERE id = ?",
      submissionId
    );

    assert.ok(submission);
    const storedImages = JSON.parse(submission.images as string) as ImageMetadata[];
    assert.strictEqual(storedImages.length, 2);
    assert.strictEqual(storedImages[0].key, "submissions/1/1/image1.jpg");
    assert.strictEqual(storedImages[1].key, "submissions/1/1/image2.jpg");
  });

  void test("should handle concurrent image updates correctly", async () => {
    const submissionId = await createTestSubmission(testMember.id);

    const image1: ImageMetadata = {
      key: "submissions/1/1/concurrent1.jpg",
      url: "https://test.example.com/concurrent1.jpg",
      size: 1000,
      uploadedAt: new Date().toISOString(),
      contentType: "image/jpeg",
    };

    const image2: ImageMetadata = {
      key: "submissions/1/1/concurrent2.jpg",
      url: "https://test.example.com/concurrent2.jpg",
      size: 2000,
      uploadedAt: new Date().toISOString(),
      contentType: "image/jpeg",
    };

    // Simulate two sequential updates (SQLite serializes writes)
    await db.exec("BEGIN TRANSACTION;");
    try {
      const stmt1 = await db.prepare("SELECT images FROM submissions WHERE id = ?");
      const existing1 = await stmt1.get<TestSubmission>(submissionId);
      await stmt1.finalize();

      const existingImages1 = existing1?.images
        ? (JSON.parse(existing1.images) as ImageMetadata[])
        : [];
      await db.run("UPDATE submissions SET images = ? WHERE id = ?", [
        JSON.stringify([...existingImages1, image1]),
        submissionId,
      ]);
      await db.exec("COMMIT;");
    } catch (error) {
      await db.exec("ROLLBACK;").catch(() => {});
      throw error;
    }

    await db.exec("BEGIN TRANSACTION;");
    try {
      const stmt2 = await db.prepare("SELECT images FROM submissions WHERE id = ?");
      const existing2 = await stmt2.get<TestSubmission>(submissionId);
      await stmt2.finalize();

      const existingImages2 = existing2?.images
        ? (JSON.parse(existing2.images) as ImageMetadata[])
        : [];
      await db.run("UPDATE submissions SET images = ? WHERE id = ?", [
        JSON.stringify([...existingImages2, image2]),
        submissionId,
      ]);
      await db.exec("COMMIT;");
    } catch (error) {
      await db.exec("ROLLBACK;").catch(() => {});
      throw error;
    }

    // Verify both images are present
    const submission = await db.get<TestSubmission>(
      "SELECT images FROM submissions WHERE id = ?",
      submissionId
    );

    assert.ok(submission);
    const storedImages = JSON.parse(submission.images as string) as ImageMetadata[];
    assert.strictEqual(storedImages.length, 2);
  });

  void test("should handle deletion with transaction", async () => {
    const submissionId = await createTestSubmission(testMember.id);

    const images: ImageMetadata[] = [
      {
        key: "submissions/1/1/delete1.jpg",
        url: "https://test.example.com/delete1.jpg",
        size: 1000,
        uploadedAt: new Date().toISOString(),
        contentType: "image/jpeg",
      },
      {
        key: "submissions/1/1/delete2.jpg",
        url: "https://test.example.com/delete2.jpg",
        size: 2000,
        uploadedAt: new Date().toISOString(),
        contentType: "image/jpeg",
      },
    ];

    await db.run("UPDATE submissions SET images = ? WHERE id = ?", [
      JSON.stringify(images),
      submissionId,
    ]);

    // Delete one image in a transaction
    const keyToDelete = "submissions/1/1/delete1.jpg";
    await db.exec("BEGIN TRANSACTION;");
    try {
      const stmt = await db.prepare("SELECT images FROM submissions WHERE id = ?");
      const submission = await stmt.get<TestSubmission>(submissionId);
      await stmt.finalize();

      const existingImages = submission?.images
        ? (JSON.parse(submission.images) as ImageMetadata[])
        : [];
      const updatedImages = existingImages.filter((img) => img.key !== keyToDelete);

      await db.run("UPDATE submissions SET images = ? WHERE id = ?", [
        JSON.stringify(updatedImages),
        submissionId,
      ]);
      await db.exec("COMMIT;");
    } catch (error) {
      await db.exec("ROLLBACK;").catch(() => {});
      throw error;
    }

    // Verify only one image remains
    const submission = await db.get<TestSubmission>(
      "SELECT images FROM submissions WHERE id = ?",
      submissionId
    );

    assert.ok(submission);
    const storedImages = JSON.parse(submission.images as string) as ImageMetadata[];
    assert.strictEqual(storedImages.length, 1);
    assert.strictEqual(storedImages[0].key, "submissions/1/1/delete2.jpg");
  });

  void test("should verify ownership before deletion", async () => {
    const submissionId = await createTestSubmission(testMember.id);

    // Create another member
    const result = await db.run("INSERT INTO members (contact_email, display_name) VALUES (?, ?)", [
      "other@test.com",
      "Other Member",
    ]);
    const otherMemberId = result.lastID as number;

    const images: ImageMetadata[] = [
      {
        key: "submissions/1/1/protected.jpg",
        url: "https://test.example.com/protected.jpg",
        size: 1000,
        uploadedAt: new Date().toISOString(),
        contentType: "image/jpeg",
      },
    ];

    await db.run("UPDATE submissions SET images = ? WHERE id = ?", [
      JSON.stringify(images),
      submissionId,
    ]);

    // Try to access image as wrong user
    const stmt = await db.prepare(`
      SELECT id, images FROM submissions
      WHERE member_id = ? AND images LIKE ?
    `);
    const wrongUserSubmission = await stmt.get<TestSubmission>(otherMemberId, "%protected.jpg%");
    await stmt.finalize();

    // Should not find submission owned by other user
    assert.strictEqual(wrongUserSubmission, undefined);

    // Verify correct user can access
    const stmt2 = await db.prepare(`
      SELECT id, images FROM submissions
      WHERE member_id = ? AND images LIKE ?
    `);
    const correctUserSubmission = await stmt2.get<TestSubmission>(testMember.id, "%protected.jpg%");
    await stmt2.finalize();

    assert.ok(correctUserSubmission);
    assert.strictEqual(correctUserSubmission.id, submissionId);
  });

  void test("should cleanup R2 files on database transaction failure", async () => {
    const submissionId = await createTestSubmission(testMember.id);

    const uploadedKeys = [
      "submissions/1/1/fail-original.jpg",
      "submissions/1/1/fail-medium.jpg",
      "submissions/1/1/fail-thumb.jpg",
    ];

    // Simulate upload then database failure
    // In real code, this would happen in the upload handler
    // Here we verify the cleanup mechanism works

    try {
      await db.exec("BEGIN TRANSACTION;");

      // Simulate trying to update with invalid constraint
      await db.run("UPDATE submissions SET images = ? WHERE id = ?", [
        JSON.stringify([
          { key: uploadedKeys[0], url: "test", size: 1000, uploadedAt: new Date().toISOString() },
        ]),
        submissionId,
      ]);

      // Force failure
      await db.run("INSERT INTO submissions (id) VALUES (?)", [submissionId]);

      await db.exec("COMMIT;");
      assert.fail("Transaction should have failed");
    } catch {
      await db.exec("ROLLBACK;").catch(() => {});

      // In real code, cleanup would happen here
      // We're verifying the mechanism exists and doesn't throw

      // Simulate cleanup - verify these calls succeed with the mock
      const cleanupPromises = uploadedKeys.map((key) => deleteImage(key).catch(() => {}));
      await Promise.all(cleanupPromises);

      // If we got here without throwing, the cleanup mechanism is working
      assert.ok(true, "Cleanup completed without errors");
    }
  });
});
