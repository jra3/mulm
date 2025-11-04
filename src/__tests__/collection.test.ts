import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import {
  getCollectionForMember,
  addToCollection,
  updateCollectionEntry,
  removeFromCollection,
  getCollectionEntry,
  getCollectionStats,
  getSpeciesKeepers,
  getRecentCollectionAdditions,
  updateCollectionImages,
} from "../db/collection";
import type { ImageMetadata } from "../utils/upload";

void describe("Species Collection Database Module", () => {
  let db: Database;
  let memberId1: number;
  let memberId2: number;
  let speciesId1: number;
  let speciesId2: number;
  let speciesId3: number;

  beforeEach(async () => {
    // Set up in-memory database
    db = await open({
      filename: ":memory:",
      driver: sqlite3.Database,
    });

    await db.exec("PRAGMA foreign_keys = ON;");
    await db.migrate({ migrationsPath: "./db/migrations" });
    overrideConnection(db);

    // Create test members
    const member1 = await db.run(
      "INSERT INTO members (display_name, contact_email) VALUES (?, ?)",
      ["Test User 1", "test1@example.com"]
    );
    memberId1 = member1.lastID as number;

    const member2 = await db.run(
      "INSERT INTO members (display_name, contact_email) VALUES (?, ?)",
      ["Test User 2", "test2@example.com"]
    );
    memberId2 = member2.lastID as number;

    // Create test species with unique names to avoid conflicts with migration data
    const species1 = await db.run(`
      INSERT INTO species_name_group (
        program_class, species_type, canonical_genus, canonical_species_name,
        base_points, is_cares_species
      ) VALUES ('Cichlids', 'Fish', 'TestGenus', 'testspecies1', 10, 0)
    `);
    speciesId1 = species1.lastID as number;

    // Add common name for species1
    await db.run(
      "INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)",
      [speciesId1, "Test Cichlid 1"]
    );

    const species2 = await db.run(`
      INSERT INTO species_name_group (
        program_class, species_type, canonical_genus, canonical_species_name,
        base_points, is_cares_species
      ) VALUES ('Livebearers', 'Fish', 'TestGenus', 'testspecies2', 5, 0)
    `);
    speciesId2 = species2.lastID as number;

    await db.run(
      "INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)",
      [speciesId2, "Test Livebearer 2"]
    );

    const species3 = await db.run(`
      INSERT INTO species_name_group (
        program_class, species_type, canonical_genus, canonical_species_name,
        base_points, is_cares_species
      ) VALUES ('Killifish', 'Fish', 'TestGenus', 'testspecies3', 20, 1)
    `);
    speciesId3 = species3.lastID as number;

    await db.run(
      "INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)",
      [speciesId3, "Test Killifish 3"]
    );
  });

  afterEach(async () => {
    await db.close();
  });

  void describe("addToCollection", () => {
    void test("should add species to collection with default values", async () => {
      const id = await addToCollection(memberId1, {
        group_id: speciesId1,
      });

      assert.ok(id > 0, "Should return a valid ID");

      const entry = await db.get(
        "SELECT * FROM species_collection WHERE id = ?",
        id
      );
      assert.equal(entry.member_id, memberId1);
      assert.equal(entry.group_id, speciesId1);
      assert.equal(entry.quantity, 1);
      assert.equal(entry.visibility, "public");
      assert.ok(entry.acquired_date);
      assert.equal(entry.removed_date, null);
    });

    void test("should add species with custom values", async () => {
      const id = await addToCollection(memberId1, {
        group_id: speciesId2,
        quantity: 5,
        acquired_date: "2024-01-15",
        notes: "Breeding pair plus juveniles",
        visibility: "private",
      });

      const entry = await db.get(
        "SELECT * FROM species_collection WHERE id = ?",
        id
      );
      assert.equal(entry.quantity, 5);
      assert.equal(entry.acquired_date, "2024-01-15");
      assert.equal(entry.notes, "Breeding pair plus juveniles");
      assert.equal(entry.visibility, "private");
    });

    void test("should prevent duplicate active entries", async () => {
      await addToCollection(memberId1, { group_id: speciesId1 });

      await assert.rejects(
        async () => await addToCollection(memberId1, { group_id: speciesId1 }),
        /Species already in collection/
      );
    });

    void test("should allow re-adding previously removed species", async () => {
      const id1 = await addToCollection(memberId1, { group_id: speciesId1 });
      await removeFromCollection(id1, memberId1);

      const id2 = await addToCollection(memberId1, { group_id: speciesId1 });
      assert.ok(id2 > 0);
      assert.notEqual(id1, id2);
    });

    void test("should enforce foreign key constraint for invalid species", async () => {
      await assert.rejects(
        async () => await addToCollection(memberId1, { group_id: 99999 }),
        /FOREIGN KEY constraint/
      );
    });

    void test("should enforce foreign key constraint for invalid member", async () => {
      await assert.rejects(
        async () => await addToCollection(99999, { group_id: speciesId1 }),
        /FOREIGN KEY constraint/
      );
    });

    void test("should handle maximum quantity", async () => {
      const id = await addToCollection(memberId1, {
        group_id: speciesId1,
        quantity: 999,
      });

      const entry = await db.get(
        "SELECT * FROM species_collection WHERE id = ?",
        id
      );
      assert.equal(entry.quantity, 999);
    });
  });

  void describe("getCollectionForMember", () => {
    beforeEach(async () => {
      // Add test entries
      await addToCollection(memberId1, {
        group_id: speciesId1,
        visibility: "public",
      });
      await addToCollection(memberId1, {
        group_id: speciesId2,
        visibility: "private",
      });
      const removedId = await addToCollection(memberId1, {
        group_id: speciesId3,
      });
      await removeFromCollection(removedId, memberId1);
    });

    void test("should get current public entries by default", async () => {
      const collection = await getCollectionForMember(memberId1);
      assert.equal(collection.length, 1);
      assert.equal(collection[0].species?.common_name, "Test Cichlid 1");
    });

    void test("should include private entries for owner", async () => {
      const collection = await getCollectionForMember(memberId1, {
        includePrivate: true,
        viewerId: memberId1,
      });
      assert.equal(collection.length, 2);
    });

    void test("should exclude private entries for other viewers", async () => {
      const collection = await getCollectionForMember(memberId1, {
        includePrivate: false,
        viewerId: memberId2,
      });
      assert.equal(collection.length, 1);
      assert.equal(collection[0].visibility, "public");
    });

    void test("should include removed entries when requested", async () => {
      const collection = await getCollectionForMember(memberId1, {
        includeRemoved: true,
        includePrivate: true,
        viewerId: memberId1,
      });
      assert.equal(collection.length, 3);
      assert.ok(collection.some(e => e.removed_date !== null));
    });

    void test("should return species details in joined data", async () => {
      const collection = await getCollectionForMember(memberId1, {
        includePrivate: true,
        viewerId: memberId1,
      });

      const entry = collection[0];
      assert.ok(entry.species);
      assert.equal(entry.species.common_name, "Test Cichlid 1");
      assert.equal(entry.species.scientific_name, "testspecies1 TestGenus");
      assert.equal(entry.species.program_class, "Cichlids");
      assert.equal(entry.species.species_type, "Fish");
      assert.equal(entry.species.is_cares_species, false);
    });

    void test("should return member details in joined data", async () => {
      const collection = await getCollectionForMember(memberId1, {
        includePrivate: true,
        viewerId: memberId1,
      });

      const entry = collection[0];
      assert.ok(entry.member);
      assert.equal(entry.member.display_name, "Test User 1");
      assert.equal(entry.member.id, memberId1);
    });

    void test("should return empty array for member with no collection", async () => {
      const collection = await getCollectionForMember(memberId2);
      assert.equal(collection.length, 0);
    });

    void test("should parse images JSON correctly", async () => {
      const images: ImageMetadata[] = [
        { key: "test.jpg", url: "https://example.com/test.jpg", size: 12345 },
      ];

      const id = await addToCollection(memberId2, { group_id: speciesId1 });
      await updateCollectionImages(id, memberId2, images);

      const collection = await getCollectionForMember(memberId2, {
        viewerId: memberId2,
      });
      assert.ok(collection[0].images);
      assert.equal(collection[0].images[0].key, "test.jpg");
    });
  });

  void describe("updateCollectionEntry", () => {
    let entryId: number;

    beforeEach(async () => {
      entryId = await addToCollection(memberId1, {
        group_id: speciesId1,
        quantity: 2,
        notes: "Initial notes",
      });
    });

    void test("should update quantity", async () => {
      await updateCollectionEntry(entryId, memberId1, { quantity: 5 });

      const entry = await db.get(
        "SELECT * FROM species_collection WHERE id = ?",
        entryId
      );
      assert.equal(entry.quantity, 5);
      assert.equal(entry.notes, "Initial notes"); // Unchanged
    });

    void test("should update notes", async () => {
      await updateCollectionEntry(entryId, memberId1, {
        notes: "Updated notes",
      });

      const entry = await db.get(
        "SELECT * FROM species_collection WHERE id = ?",
        entryId
      );
      assert.equal(entry.notes, "Updated notes");
    });

    void test("should update visibility", async () => {
      await updateCollectionEntry(entryId, memberId1, {
        visibility: "private",
      });

      const entry = await db.get(
        "SELECT * FROM species_collection WHERE id = ?",
        entryId
      );
      assert.equal(entry.visibility, "private");
    });

    void test("should update removed_date for soft delete", async () => {
      await updateCollectionEntry(entryId, memberId1, {
        removed_date: "2024-11-01",
      });

      const entry = await db.get(
        "SELECT * FROM species_collection WHERE id = ?",
        entryId
      );
      assert.equal(entry.removed_date, "2024-11-01");
    });

    void test("should update multiple fields at once", async () => {
      await updateCollectionEntry(entryId, memberId1, {
        quantity: 10,
        notes: "Bulk update",
        visibility: "private",
      });

      const entry = await db.get(
        "SELECT * FROM species_collection WHERE id = ?",
        entryId
      );
      assert.equal(entry.quantity, 10);
      assert.equal(entry.notes, "Bulk update");
      assert.equal(entry.visibility, "private");
    });

    void test("should update images", async () => {
      const images: ImageMetadata[] = [
        { key: "img1.jpg", url: "https://example.com/img1.jpg", size: 1000 },
        { key: "img2.jpg", url: "https://example.com/img2.jpg", size: 2000 },
      ];

      await updateCollectionEntry(entryId, memberId1, { images });

      const entry = await db.get(
        "SELECT * FROM species_collection WHERE id = ?",
        entryId
      );
      const parsedImages = JSON.parse(entry.images);
      assert.equal(parsedImages.length, 2);
      assert.equal(parsedImages[0].key, "img1.jpg");
    });

    void test("should update updated_at timestamp", async () => {
      const before = await db.get(
        "SELECT updated_at FROM species_collection WHERE id = ?",
        entryId
      );

      // Wait a full second to ensure timestamp changes (SQLite CURRENT_TIMESTAMP has second precision)
      await new Promise(resolve => setTimeout(resolve, 1100));

      await updateCollectionEntry(entryId, memberId1, { quantity: 3 });

      const after = await db.get(
        "SELECT updated_at FROM species_collection WHERE id = ?",
        entryId
      );

      assert.notEqual(before.updated_at, after.updated_at);
    });

    void test("should throw error if entry not found", async () => {
      await assert.rejects(
        async () => await updateCollectionEntry(99999, memberId1, { quantity: 5 }),
        /Collection entry not found or access denied/
      );
    });

    void test("should throw error if member doesn't own entry", async () => {
      await assert.rejects(
        async () => await updateCollectionEntry(entryId, memberId2, { quantity: 5 }),
        /Collection entry not found or access denied/
      );
    });
  });

  void describe("removeFromCollection", () => {
    let entryId: number;

    beforeEach(async () => {
      entryId = await addToCollection(memberId1, { group_id: speciesId1 });
    });

    void test("should soft delete entry by setting removed_date", async () => {
      await removeFromCollection(entryId, memberId1);

      const entry = await db.get(
        "SELECT * FROM species_collection WHERE id = ?",
        entryId
      );
      assert.ok(entry.removed_date);
      assert.ok(entry); // Entry still exists in database
    });

    void test("should update updated_at when removing", async () => {
      const before = await db.get(
        "SELECT updated_at FROM species_collection WHERE id = ?",
        entryId
      );

      // Wait a full second to ensure timestamp changes (SQLite CURRENT_TIMESTAMP has second precision)
      await new Promise(resolve => setTimeout(resolve, 1100));
      await removeFromCollection(entryId, memberId1);

      const after = await db.get(
        "SELECT updated_at FROM species_collection WHERE id = ?",
        entryId
      );

      assert.notEqual(before.updated_at, after.updated_at);
    });

    void test("should throw error if already removed", async () => {
      await removeFromCollection(entryId, memberId1);

      await assert.rejects(
        async () => await removeFromCollection(entryId, memberId1),
        /Collection entry not found, already removed, or access denied/
      );
    });

    void test("should throw error if member doesn't own entry", async () => {
      await assert.rejects(
        async () => await removeFromCollection(entryId, memberId2),
        /Collection entry not found, already removed, or access denied/
      );
    });

    void test("should not appear in active collection after removal", async () => {
      await removeFromCollection(entryId, memberId1);

      const collection = await getCollectionForMember(memberId1, {
        includePrivate: true,
        viewerId: memberId1,
      });
      assert.equal(collection.length, 0);
    });
  });

  void describe("getCollectionEntry", () => {
    let publicEntryId: number;
    let privateEntryId: number;

    beforeEach(async () => {
      publicEntryId = await addToCollection(memberId1, {
        group_id: speciesId1,
        visibility: "public",
      });
      privateEntryId = await addToCollection(memberId1, {
        group_id: speciesId2,
        visibility: "private",
      });
    });

    void test("should get public entry without member ID", async () => {
      const entry = await getCollectionEntry(publicEntryId);
      assert.ok(entry);
      assert.equal(entry.group_id, speciesId1);
    });

    void test("should not get private entry without member ID", async () => {
      const entry = await getCollectionEntry(privateEntryId);
      assert.equal(entry, null);
    });

    void test("should get private entry for owner", async () => {
      const entry = await getCollectionEntry(privateEntryId, memberId1);
      assert.ok(entry);
      assert.equal(entry.group_id, speciesId2);
    });

    void test("should not get private entry for other member", async () => {
      const entry = await getCollectionEntry(privateEntryId, memberId2);
      assert.equal(entry, null);
    });

    void test("should include species details", async () => {
      const entry = await getCollectionEntry(publicEntryId);
      assert.ok(entry?.species);
      assert.equal(entry.species.common_name, "Test Cichlid 1");
    });

    void test("should return null for non-existent entry", async () => {
      const entry = await getCollectionEntry(99999);
      assert.equal(entry, null);
    });
  });

  void describe("getCollectionStats", () => {
    beforeEach(async () => {
      // Add various entries for member1
      await addToCollection(memberId1, { group_id: speciesId1 }); // Cichlids
      await addToCollection(memberId1, { group_id: speciesId2 }); // Livebearers
      const removedId = await addToCollection(memberId1, {
        group_id: speciesId3,
      }); // Killifish
      await removeFromCollection(removedId, memberId1);
    });

    void test("should calculate current and lifetime counts", async () => {
      const stats = await getCollectionStats(memberId1);
      assert.equal(stats.current, 2);
      assert.equal(stats.lifetime, 3);
    });

    void test("should break down by program class", async () => {
      const stats = await getCollectionStats(memberId1);
      assert.equal(stats.byClass["Cichlids"], 1);
      assert.equal(stats.byClass["Livebearers"], 1);
      assert.equal(stats.byClass["Killifish"], undefined); // Removed
    });

    void test("should break down by species type", async () => {
      const stats = await getCollectionStats(memberId1);
      assert.equal(stats.byType["Fish"], 2);
    });

    void test("should return zero counts for member with no collection", async () => {
      const stats = await getCollectionStats(memberId2);
      assert.equal(stats.current, 0);
      assert.equal(stats.lifetime, 0);
      assert.deepEqual(stats.byClass, {});
      assert.deepEqual(stats.byType, {});
    });

    void test("should handle member with only removed entries", async () => {
      const id = await addToCollection(memberId2, { group_id: speciesId1 });
      await removeFromCollection(id, memberId2);

      const stats = await getCollectionStats(memberId2);
      assert.equal(stats.current, 0);
      assert.equal(stats.lifetime, 1);
      assert.deepEqual(stats.byClass, {});
    });
  });

  void describe("getSpeciesKeepers", () => {
    beforeEach(async () => {
      // Multiple members keeping same species
      await addToCollection(memberId1, {
        group_id: speciesId1,
        quantity: 2,
        visibility: "public",
      });
      await addToCollection(memberId2, {
        group_id: speciesId1,
        quantity: 5,
        visibility: "public",
      });
      // Private entry shouldn't be counted by default
      const member3 = await db.run(
        "INSERT INTO members (display_name, contact_email) VALUES (?, ?)",
        ["Private Keeper", "private@example.com"]
      );
      await addToCollection(member3.lastID as number, {
        group_id: speciesId1,
        visibility: "private",
      });
    });

    void test("should count public keepers only by default", async () => {
      const result = await getSpeciesKeepers(speciesId1);
      assert.equal(result.count, 2);
      assert.equal(result.members.length, 2);
    });

    void test("should include member details and quantities", async () => {
      const result = await getSpeciesKeepers(speciesId1);
      const member1Data = result.members.find(m => m.id === memberId1);
      assert.equal(member1Data?.display_name, "Test User 1");
      assert.equal(member1Data?.quantity, 2);
    });

    void test("should include private entries when requested", async () => {
      const result = await getSpeciesKeepers(speciesId1, {
        includePrivate: true,
      });
      assert.equal(result.count, 3);
    });

    void test("should exclude removed entries", async () => {
      const entry = await db.get<{ id: number }>(
        "SELECT id FROM species_collection WHERE member_id = ? AND group_id = ?",
        memberId1,
        speciesId1
      );
      if (!entry) throw new Error("Entry not found");
      await removeFromCollection(entry.id, memberId1);

      const result = await getSpeciesKeepers(speciesId1);
      assert.equal(result.count, 1);
    });

    void test("should return empty for species with no keepers", async () => {
      const result = await getSpeciesKeepers(speciesId2);
      assert.equal(result.count, 0);
      assert.equal(result.members.length, 0);
    });

    void test("should order members alphabetically", async () => {
      const result = await getSpeciesKeepers(speciesId1);
      assert.equal(result.members[0].display_name, "Test User 1");
      assert.equal(result.members[1].display_name, "Test User 2");
    });
  });

  void describe("getRecentCollectionAdditions", () => {
    beforeEach(async () => {
      // Add entries with full second delays to ensure proper ordering with SQLite timestamp precision
      await addToCollection(memberId1, {
        group_id: speciesId1,
        visibility: "public",
      });
      await new Promise(resolve => setTimeout(resolve, 1100));
      await addToCollection(memberId2, {
        group_id: speciesId2,
        visibility: "public",
      });
      await new Promise(resolve => setTimeout(resolve, 1100));
      await addToCollection(memberId1, {
        group_id: speciesId3,
        visibility: "private",
      }); // Should be excluded
    });

    void test("should return recent public additions", async () => {
      const recent = await getRecentCollectionAdditions(10);
      assert.equal(recent.length, 2);
    });

    void test("should order by most recent first", async () => {
      const recent = await getRecentCollectionAdditions(10);
      assert.equal(recent[0].species?.common_name, "Test Livebearer 2");
      assert.equal(recent[1].species?.common_name, "Test Cichlid 1");
    });

    void test("should exclude private entries", async () => {
      const recent = await getRecentCollectionAdditions(10);
      assert.ok(recent.every(e => e.visibility === "public"));
    });

    void test("should exclude removed entries", async () => {
      const entry = await db.get<{ id: number }>(
        "SELECT id FROM species_collection WHERE group_id = ?",
        speciesId2
      );
      if (!entry) throw new Error("Entry not found");
      await removeFromCollection(entry.id, memberId2);

      const recent = await getRecentCollectionAdditions(10);
      assert.equal(recent.length, 1);
      assert.equal(recent[0].species?.common_name, "Test Cichlid 1");
    });

    void test("should respect limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        const species = await db.run(
          `INSERT INTO species_name_group (
            program_class, species_type, canonical_genus, canonical_species_name
          ) VALUES ('Test', 'Fish', 'Test', 'species${i}')
        `);
        await addToCollection(memberId1, {
          group_id: species.lastID as number,
        });
      }

      const recent = await getRecentCollectionAdditions(3);
      assert.equal(recent.length, 3);
    });

    void test("should include all necessary fields", async () => {
      const recent = await getRecentCollectionAdditions(1);
      const entry = recent[0];

      assert.ok(entry.id);
      assert.ok(entry.member_id);
      assert.ok(entry.group_id);
      assert.ok(entry.quantity);
      assert.ok(entry.acquired_date);
      assert.ok(entry.species);
      assert.ok(entry.member);
      assert.equal(entry.removed_date, null);
    });
  });

  void describe("updateCollectionImages", () => {
    let entryId: number;

    beforeEach(async () => {
      entryId = await addToCollection(memberId1, { group_id: speciesId1 });
    });

    void test("should update images successfully", async () => {
      const images: ImageMetadata[] = [
        { key: "img1.jpg", url: "https://example.com/img1.jpg", size: 1000 },
        { key: "img2.jpg", url: "https://example.com/img2.jpg", size: 2000 },
      ];

      await updateCollectionImages(entryId, memberId1, images);

      const entry = await db.get(
        "SELECT images FROM species_collection WHERE id = ?",
        entryId
      );
      const parsed = JSON.parse(entry.images);
      assert.equal(parsed.length, 2);
    });

    void test("should enforce maximum 5 images", async () => {
      const images: ImageMetadata[] = [];
      for (let i = 0; i < 6; i++) {
        images.push({
          key: `img${i}.jpg`,
          url: `https://example.com/img${i}.jpg`,
          size: 1000,
        });
      }

      await assert.rejects(
        async () => await updateCollectionImages(entryId, memberId1, images),
        /Maximum 5 images allowed/
      );
    });

    void test("should allow exactly 5 images", async () => {
      const images: ImageMetadata[] = [];
      for (let i = 0; i < 5; i++) {
        images.push({
          key: `img${i}.jpg`,
          url: `https://example.com/img${i}.jpg`,
          size: 1000,
        });
      }

      await updateCollectionImages(entryId, memberId1, images);

      const entry = await db.get(
        "SELECT images FROM species_collection WHERE id = ?",
        entryId
      );
      const parsed = JSON.parse(entry.images);
      assert.equal(parsed.length, 5);
    });

    void test("should replace existing images", async () => {
      const oldImages: ImageMetadata[] = [
        { key: "old.jpg", url: "https://example.com/old.jpg", size: 1000 },
      ];
      await updateCollectionImages(entryId, memberId1, oldImages);

      const newImages: ImageMetadata[] = [
        { key: "new.jpg", url: "https://example.com/new.jpg", size: 2000 },
      ];
      await updateCollectionImages(entryId, memberId1, newImages);

      const entry = await db.get(
        "SELECT images FROM species_collection WHERE id = ?",
        entryId
      );
      const parsed = JSON.parse(entry.images);
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].key, "new.jpg");
    });

    void test("should allow empty array to clear images", async () => {
      const images: ImageMetadata[] = [
        { key: "img.jpg", url: "https://example.com/img.jpg", size: 1000 },
      ];
      await updateCollectionImages(entryId, memberId1, images);

      await updateCollectionImages(entryId, memberId1, []);

      const entry = await db.get(
        "SELECT images FROM species_collection WHERE id = ?",
        entryId
      );
      assert.equal(entry.images, "[]");
    });

    void test("should reject if member doesn't own entry", async () => {
      const images: ImageMetadata[] = [
        { key: "img.jpg", url: "https://example.com/img.jpg", size: 1000 },
      ];

      await assert.rejects(
        async () => await updateCollectionImages(entryId, memberId2, images),
        /Collection entry not found or access denied/
      );
    });
  });

  void describe("Edge cases and data integrity", () => {
    void test("should handle very long notes", async () => {
      const longNotes = "A".repeat(5000);
      const id = await addToCollection(memberId1, {
        group_id: speciesId1,
        notes: longNotes,
      });

      const entry = await getCollectionEntry(id);
      assert.equal(entry?.notes?.length, 5000);
    });

    void test("should handle null notes properly", async () => {
      const id = await addToCollection(memberId1, {
        group_id: speciesId1,
        notes: undefined,
      });

      const entry = await getCollectionEntry(id);
      assert.equal(entry?.notes, null);
    });

    void test("should handle species with no common name", async () => {
      const species = await db.run(`
        INSERT INTO species_name_group (
          program_class, species_type, canonical_genus, canonical_species_name
        ) VALUES ('Test', 'Fish', 'Testicus', 'nocommon')
      `);

      await addToCollection(memberId1, {
        group_id: species.lastID as number,
      });

      const collection = await getCollectionForMember(memberId1);
      assert.ok(collection[0].species);
      assert.equal(collection[0].species.common_name, null);
    });

    void test("should handle concurrent additions of different species", async () => {
      const promises = [
        addToCollection(memberId1, { group_id: speciesId1 }),
        addToCollection(memberId1, { group_id: speciesId2 }),
        addToCollection(memberId1, { group_id: speciesId3 }),
      ];

      const ids = await Promise.all(promises);
      assert.equal(ids.length, 3);
      assert.ok(ids.every(id => id > 0));

      const collection = await getCollectionForMember(memberId1, {
        includePrivate: true,
        viewerId: memberId1,
      });
      assert.equal(collection.length, 3);
    });

    void test("should maintain referential integrity on member deletion", async () => {
      await addToCollection(memberId1, { group_id: speciesId1 });

      await db.run("DELETE FROM members WHERE id = ?", memberId1);

      const orphaned = await db.get(
        "SELECT * FROM species_collection WHERE member_id = ?",
        memberId1
      );
      assert.equal(orphaned, undefined);
    });

    void test("should maintain referential integrity on species deletion", async () => {
      const entryId = await addToCollection(memberId1, {
        group_id: speciesId1,
      });

      await db.run("DELETE FROM species_name_group WHERE group_id = ?", speciesId1);

      const orphaned = await db.get(
        "SELECT * FROM species_collection WHERE id = ?",
        entryId
      );
      assert.equal(orphaned, undefined);
    });

    void test("should handle date edge cases", async () => {
      // Test with past date
      const id1 = await addToCollection(memberId1, {
        group_id: speciesId1,
        acquired_date: "2020-01-01",
      });

      // Test with future date (should work, though maybe not logical)
      const id2 = await addToCollection(memberId1, {
        group_id: speciesId2,
        acquired_date: "2030-12-31",
      });

      const entry1 = await getCollectionEntry(id1);
      const entry2 = await getCollectionEntry(id2);

      assert.equal(entry1?.acquired_date, "2020-01-01");
      assert.equal(entry2?.acquired_date, "2030-12-31");
    });

    void test("should handle quantity boundaries", async () => {
      // Minimum quantity
      const id1 = await addToCollection(memberId1, {
        group_id: speciesId1,
        quantity: 1,
      });

      // Maximum quantity
      const id2 = await addToCollection(memberId1, {
        group_id: speciesId2,
        quantity: 999,
      });

      const entry1 = await getCollectionEntry(id1);
      const entry2 = await getCollectionEntry(id2);

      assert.equal(entry1?.quantity, 1);
      assert.equal(entry2?.quantity, 999);
    });

    void test("should handle CARES species flag correctly", async () => {
      await addToCollection(memberId1, { group_id: speciesId3 }); // CARES species

      const collection = await getCollectionForMember(memberId1);
      const caresEntry = collection.find(e => e.group_id === speciesId3);

      assert.ok(caresEntry?.species);
      assert.equal(caresEntry.species.is_cares_species, true);
    });
  });
});