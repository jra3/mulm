import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import {
  registerForCares,
  updateCaresPhoto,
  getCaresEligibility,
  getCaresProfile,
  getCaresRegistrations,
  createFryShare,
  getCaresStats,
  isMemberCaresParticipant,
  getMemberCaresCount,
} from "../db/cares";

void describe("CARES Database Module", () => {
  let db: Database;
  let memberId1: number;
  let memberId2: number;
  let caresGroupId: number;
  let nonCaresGroupId: number;
  let caresCollectionId: number; // member1's unregistered collection entry for caresGroupId

  beforeEach(async () => {
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

    // Create a CARES-eligible species
    const caresSpecies = await db.run(`
      INSERT INTO species_name_group (
        program_class, species_type, canonical_genus, canonical_species_name,
        base_points, is_cares_species
      ) VALUES ('Cichlids', 'Fish', 'CaresGenus', 'caresspecies', 10, 1)
    `);
    caresGroupId = caresSpecies.lastID as number;

    await db.run(
      "INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)",
      [caresGroupId, "CARES Cichlid"]
    );

    // Create a non-CARES species
    const nonCaresSpecies = await db.run(`
      INSERT INTO species_name_group (
        program_class, species_type, canonical_genus, canonical_species_name,
        base_points, is_cares_species
      ) VALUES ('Livebearers', 'Fish', 'NormalGenus', 'normalspecies', 5, 0)
    `);
    nonCaresGroupId = nonCaresSpecies.lastID as number;

    await db.run(
      "INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)",
      [nonCaresGroupId, "Normal Livebearer"]
    );

    // Add CARES species to member1's collection (not yet registered)
    const collection = await db.run(
      "INSERT INTO species_collection (member_id, group_id) VALUES (?, ?)",
      [memberId1, caresGroupId]
    );
    caresCollectionId = collection.lastID as number;
  });

  afterEach(async () => {
    await db.close();
  });

  void describe("registerForCares", () => {
    void test("should register a CARES-eligible collection entry", async () => {
      await registerForCares(
        caresCollectionId,
        memberId1,
        "photos/test-key.jpg",
        "https://example.com/test.jpg"
      );

      const row = await db.get(
        "SELECT cares_registered_at, cares_photo_key, cares_photo_url FROM species_collection WHERE id = ?",
        caresCollectionId
      );
      assert.ok(row.cares_registered_at, "cares_registered_at should be set");
      assert.equal(row.cares_photo_key, "photos/test-key.jpg");
      assert.equal(row.cares_photo_url, "https://example.com/test.jpg");
    });

    void test("should throw if collection entry not found", async () => {
      await assert.rejects(
        async () =>
          await registerForCares(99999, memberId1, "key.jpg", "url.jpg"),
        /Collection entry not found or access denied/
      );
    });

    void test("should throw if entry belongs to a different member", async () => {
      await assert.rejects(
        async () =>
          await registerForCares(
            caresCollectionId,
            memberId2,
            "key.jpg",
            "url.jpg"
          ),
        /Collection entry not found or access denied/
      );
    });

    void test("should throw if species is not CARES-eligible", async () => {
      const nonCaresCollection = await db.run(
        "INSERT INTO species_collection (member_id, group_id) VALUES (?, ?)",
        [memberId1, nonCaresGroupId]
      );

      await assert.rejects(
        async () =>
          await registerForCares(
            nonCaresCollection.lastID as number,
            memberId1,
            "key.jpg",
            "url.jpg"
          ),
        /This species is not part of the CARES priority list/
      );
    });

    void test("should throw if entry is already registered", async () => {
      await registerForCares(
        caresCollectionId,
        memberId1,
        "key.jpg",
        "url.jpg"
      );

      await assert.rejects(
        async () =>
          await registerForCares(
            caresCollectionId,
            memberId1,
            "newkey.jpg",
            "newurl.jpg"
          ),
        /This species is already registered for CARES/
      );
    });

    void test("should throw for removed collection entry", async () => {
      await db.run(
        "UPDATE species_collection SET removed_date = CURRENT_DATE WHERE id = ?",
        caresCollectionId
      );

      await assert.rejects(
        async () =>
          await registerForCares(
            caresCollectionId,
            memberId1,
            "key.jpg",
            "url.jpg"
          ),
        /Collection entry not found or access denied/
      );
    });
  });

  void describe("updateCaresPhoto", () => {
    beforeEach(async () => {
      await registerForCares(
        caresCollectionId,
        memberId1,
        "original-key.jpg",
        "https://example.com/original.jpg"
      );
    });

    void test("should update photo and return old key", async () => {
      const result = await updateCaresPhoto(
        caresCollectionId,
        memberId1,
        "new-key.jpg",
        "https://example.com/new.jpg"
      );

      assert.equal(result.oldPhotoKey, "original-key.jpg");

      const row = await db.get(
        "SELECT cares_photo_key, cares_photo_url FROM species_collection WHERE id = ?",
        caresCollectionId
      );
      assert.equal(row.cares_photo_key, "new-key.jpg");
      assert.equal(row.cares_photo_url, "https://example.com/new.jpg");
    });

    void test("should return null oldPhotoKey when no previous photo", async () => {
      // Clear photo key first
      await db.run(
        "UPDATE species_collection SET cares_photo_key = NULL WHERE id = ?",
        caresCollectionId
      );

      const result = await updateCaresPhoto(
        caresCollectionId,
        memberId1,
        "new-key.jpg",
        "https://example.com/new.jpg"
      );

      assert.equal(result.oldPhotoKey, null);
    });

    void test("should throw if collection entry not found", async () => {
      await assert.rejects(
        async () =>
          await updateCaresPhoto(99999, memberId1, "key.jpg", "url.jpg"),
        /Collection entry not found or access denied/
      );
    });

    void test("should throw if entry belongs to a different member", async () => {
      await assert.rejects(
        async () =>
          await updateCaresPhoto(
            caresCollectionId,
            memberId2,
            "key.jpg",
            "url.jpg"
          ),
        /Collection entry not found or access denied/
      );
    });

    void test("should throw if entry is not registered for CARES", async () => {
      // Create a non-registered collection entry
      const collection = await db.run(
        "INSERT INTO species_collection (member_id, group_id) VALUES (?, ?)",
        [memberId2, caresGroupId]
      );

      await assert.rejects(
        async () =>
          await updateCaresPhoto(
            collection.lastID as number,
            memberId2,
            "key.jpg",
            "url.jpg"
          ),
        /This species is not registered for CARES/
      );
    });
  });

  void describe("getCaresEligibility", () => {
    void test("should return null for non-existent entry", async () => {
      const result = await getCaresEligibility(99999, memberId1);
      assert.equal(result, null);
    });

    void test("should return null for entry belonging to another member", async () => {
      const result = await getCaresEligibility(caresCollectionId, memberId2);
      assert.equal(result, null);
    });

    void test("should return eligible=false for non-CARES species", async () => {
      const collection = await db.run(
        "INSERT INTO species_collection (member_id, group_id) VALUES (?, ?)",
        [memberId1, nonCaresGroupId]
      );

      const result = await getCaresEligibility(
        collection.lastID as number,
        memberId1
      );
      assert.ok(result);
      assert.equal(result.eligible, false);
      assert.equal(result.registered, false);
      assert.equal(result.photoUrl, null);
    });

    void test("should return eligible=true, registered=false for unregistered CARES species", async () => {
      const result = await getCaresEligibility(caresCollectionId, memberId1);
      assert.ok(result);
      assert.equal(result.eligible, true);
      assert.equal(result.registered, false);
      assert.equal(result.photoUrl, null);
    });

    void test("should return eligible=true, registered=true with photoUrl after registration", async () => {
      await registerForCares(
        caresCollectionId,
        memberId1,
        "key.jpg",
        "https://example.com/photo.jpg"
      );

      const result = await getCaresEligibility(caresCollectionId, memberId1);
      assert.ok(result);
      assert.equal(result.eligible, true);
      assert.equal(result.registered, true);
      assert.equal(result.photoUrl, "https://example.com/photo.jpg");
    });

    void test("should return null for removed entry", async () => {
      await db.run(
        "UPDATE species_collection SET removed_date = CURRENT_DATE WHERE id = ?",
        caresCollectionId
      );

      const result = await getCaresEligibility(caresCollectionId, memberId1);
      assert.equal(result, null);
    });
  });

  void describe("getCaresProfile", () => {
    void test("should return empty profile for member with no registrations", async () => {
      const profile = await getCaresProfile(memberId2);
      assert.equal(profile.registrations.length, 0);
      assert.equal(profile.articles.length, 0);
      assert.equal(profile.fryShares.length, 0);
    });

    void test("should return registration after registerForCares", async () => {
      await registerForCares(
        caresCollectionId,
        memberId1,
        "key.jpg",
        "https://example.com/photo.jpg"
      );

      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.registrations.length, 1);
      const reg = profile.registrations[0];
      assert.equal(reg.collection_id, caresCollectionId);
      assert.equal(reg.group_id, caresGroupId);
      assert.equal(reg.common_name, "CARES Cichlid");
      assert.equal(reg.scientific_name, "CaresGenus caresspecies");
      assert.equal(reg.cares_photo_url, "https://example.com/photo.jpg");
    });

    void test("should calculate has_photo seal flag from images array", async () => {
      await registerForCares(
        caresCollectionId,
        memberId1,
        "key.jpg",
        "https://example.com/photo.jpg"
      );
      await db.run(
        `UPDATE species_collection SET images = '[{"key":"img.jpg","url":"https://example.com/img.jpg","size":1000}]' WHERE id = ?`,
        caresCollectionId
      );

      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.registrations[0].has_photo, true);
    });

    void test("should return has_photo=false when images is null", async () => {
      await registerForCares(
        caresCollectionId,
        memberId1,
        "key.jpg",
        "https://example.com/photo.jpg"
      );

      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.registrations[0].has_photo, false);
    });

    void test("should calculate has_article seal flag", async () => {
      await registerForCares(
        caresCollectionId,
        memberId1,
        "key.jpg",
        "https://example.com/photo.jpg"
      );
      await db.run(
        "INSERT INTO cares_article (member_id, species_group_id, title) VALUES (?, ?, ?)",
        [memberId1, caresGroupId, "My CARES Article"]
      );

      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.registrations[0].has_article, true);
      assert.equal(profile.registrations[0].article_count, 1);
    });

    void test("should calculate has_internal_share seal flag", async () => {
      await registerForCares(
        caresCollectionId,
        memberId1,
        "key.jpg",
        "https://example.com/photo.jpg"
      );
      // Internal share: recipient_member_id is set
      await db.run(
        `INSERT INTO cares_fry_share
          (member_id, species_group_id, recipient_name, recipient_member_id, share_date)
         VALUES (?, ?, ?, ?, ?)`,
        [memberId1, caresGroupId, "Test User 2", memberId2, "2025-01-01"]
      );

      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.registrations[0].has_internal_share, true);
      assert.equal(profile.registrations[0].has_external_share, false);
    });

    void test("should calculate has_external_share seal flag", async () => {
      await registerForCares(
        caresCollectionId,
        memberId1,
        "key.jpg",
        "https://example.com/photo.jpg"
      );
      // External share: recipient_club is set, no recipient_member_id
      await db.run(
        `INSERT INTO cares_fry_share
          (member_id, species_group_id, recipient_name, recipient_club, share_date)
         VALUES (?, ?, ?, ?, ?)`,
        [memberId1, caresGroupId, "Other Club Contact", "Fish Club Inc", "2025-01-01"]
      );

      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.registrations[0].has_external_share, true);
      assert.equal(profile.registrations[0].has_internal_share, false);
    });

    void test("should calculate is_longevity when confirmed >= 2 years after registration", async () => {
      await registerForCares(
        caresCollectionId,
        memberId1,
        "key.jpg",
        "https://example.com/photo.jpg"
      );
      // Set registration 3 years ago, confirmed 2 years ago
      await db.run(
        `UPDATE species_collection
         SET cares_registered_at = '2020-01-01',
             cares_last_confirmed = '2022-06-01'
         WHERE id = ?`,
        caresCollectionId
      );

      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.registrations[0].is_longevity, true);
    });

    void test("should return is_longevity=false when not yet 2 years confirmed", async () => {
      await registerForCares(
        caresCollectionId,
        memberId1,
        "key.jpg",
        "https://example.com/photo.jpg"
      );
      // Registered and confirmed 1 year apart
      await db.run(
        `UPDATE species_collection
         SET cares_registered_at = '2024-01-01',
             cares_last_confirmed = '2024-06-01'
         WHERE id = ?`,
        caresCollectionId
      );

      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.registrations[0].is_longevity, false);
    });

    void test("should return articles in profile", async () => {
      await registerForCares(
        caresCollectionId,
        memberId1,
        "key.jpg",
        "https://example.com/photo.jpg"
      );
      await db.run(
        `INSERT INTO cares_article (member_id, species_group_id, title, url, published_date)
         VALUES (?, ?, ?, ?, ?)`,
        [
          memberId1,
          caresGroupId,
          "Breeding CARES Fish",
          "https://example.com/article",
          "2025-03-01",
        ]
      );

      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.articles.length, 1);
      assert.equal(profile.articles[0].title, "Breeding CARES Fish");
      assert.equal(profile.articles[0].url, "https://example.com/article");
      assert.equal(profile.articles[0].published_date, "2025-03-01");
      assert.equal(profile.articles[0].species_common_name, "CARES Cichlid");
      assert.equal(profile.articles[0].group_id, caresGroupId);
    });

    void test("should return fry shares in profile with is_external flag", async () => {
      await registerForCares(
        caresCollectionId,
        memberId1,
        "key.jpg",
        "https://example.com/photo.jpg"
      );
      // Internal share
      await db.run(
        `INSERT INTO cares_fry_share
          (member_id, species_group_id, recipient_name, recipient_member_id, share_date)
         VALUES (?, ?, ?, ?, ?)`,
        [memberId1, caresGroupId, "Test User 2", memberId2, "2025-02-01"]
      );
      // External share
      await db.run(
        `INSERT INTO cares_fry_share
          (member_id, species_group_id, recipient_name, recipient_club, share_date)
         VALUES (?, ?, ?, ?, ?)`,
        [memberId1, caresGroupId, "Club Contact", "Aquarium Society", "2025-01-01"]
      );

      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.fryShares.length, 2);

      const internal = profile.fryShares.find((f) => !f.is_external);
      const external = profile.fryShares.find((f) => f.is_external);
      assert.ok(internal);
      assert.ok(external);
      assert.equal(internal.recipient_name, "Test User 2");
      assert.equal(external.recipient_club, "Aquarium Society");
    });

    void test("should not include removed entries in registrations", async () => {
      await registerForCares(
        caresCollectionId,
        memberId1,
        "key.jpg",
        "https://example.com/photo.jpg"
      );
      await db.run(
        "UPDATE species_collection SET removed_date = CURRENT_DATE WHERE id = ?",
        caresCollectionId
      );

      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.registrations.length, 0);
    });
  });

  void describe("getCaresRegistrations", () => {
    void test("should return empty array when member has no registrations", async () => {
      const registrations = await getCaresRegistrations(memberId2);
      assert.equal(registrations.length, 0);
    });

    void test("should return empty array for unregistered collection entries", async () => {
      // caresCollectionId is in collection but not registered
      const registrations = await getCaresRegistrations(memberId1);
      assert.equal(registrations.length, 0);
    });

    void test("should return registered species", async () => {
      await registerForCares(
        caresCollectionId,
        memberId1,
        "key.jpg",
        "https://example.com/photo.jpg"
      );

      const registrations = await getCaresRegistrations(memberId1);
      assert.equal(registrations.length, 1);
      assert.equal(registrations[0].collection_id, caresCollectionId);
      assert.equal(registrations[0].group_id, caresGroupId);
      assert.equal(registrations[0].common_name, "CARES Cichlid");
      assert.equal(registrations[0].scientific_name, "CaresGenus caresspecies");
    });

    void test("should exclude removed entries", async () => {
      await registerForCares(
        caresCollectionId,
        memberId1,
        "key.jpg",
        "https://example.com/photo.jpg"
      );
      await db.run(
        "UPDATE species_collection SET removed_date = CURRENT_DATE WHERE id = ?",
        caresCollectionId
      );

      const registrations = await getCaresRegistrations(memberId1);
      assert.equal(registrations.length, 0);
    });

    void test("should return multiple registrations", async () => {
      // Register species for member1
      await registerForCares(
        caresCollectionId,
        memberId1,
        "key1.jpg",
        "https://example.com/photo1.jpg"
      );

      // Add another CARES species and register it
      const caresSpecies2 = await db.run(`
        INSERT INTO species_name_group (
          program_class, species_type, canonical_genus, canonical_species_name,
          base_points, is_cares_species
        ) VALUES ('Killifish', 'Fish', 'KilliGenus', 'killispecies', 15, 1)
      `);
      const caresGroupId2 = caresSpecies2.lastID as number;

      const collection2 = await db.run(
        "INSERT INTO species_collection (member_id, group_id) VALUES (?, ?)",
        [memberId1, caresGroupId2]
      );
      await registerForCares(
        collection2.lastID as number,
        memberId1,
        "key2.jpg",
        "https://example.com/photo2.jpg"
      );

      const registrations = await getCaresRegistrations(memberId1);
      assert.equal(registrations.length, 2);
    });
  });

  void describe("createFryShare", () => {
    beforeEach(async () => {
      // Register member1's CARES species
      await registerForCares(
        caresCollectionId,
        memberId1,
        "key.jpg",
        "https://example.com/photo.jpg"
      );
    });

    void test("should create an internal fry share and return ID", async () => {
      const id = await createFryShare(
        memberId1,
        caresGroupId,
        "Test User 2",
        memberId2,
        null,
        "2025-06-15",
        "Healthy juveniles"
      );

      assert.ok(id > 0);

      const row = await db.get(
        "SELECT * FROM cares_fry_share WHERE id = ?",
        id
      );
      assert.equal(row.member_id, memberId1);
      assert.equal(row.species_group_id, caresGroupId);
      assert.equal(row.recipient_name, "Test User 2");
      assert.equal(row.recipient_member_id, memberId2);
      assert.equal(row.recipient_club, null);
      assert.equal(row.share_date, "2025-06-15");
      assert.equal(row.notes, "Healthy juveniles");
    });

    void test("should create an external fry share", async () => {
      const id = await createFryShare(
        memberId1,
        caresGroupId,
        "Club Contact",
        null,
        "Local Aquarium Club",
        "2025-07-01",
        null
      );

      assert.ok(id > 0);

      const row = await db.get(
        "SELECT * FROM cares_fry_share WHERE id = ?",
        id
      );
      assert.equal(row.recipient_member_id, null);
      assert.equal(row.recipient_club, "Local Aquarium Club");
      assert.equal(row.notes, null);
    });

    void test("should throw if member does not have species registered for CARES", async () => {
      await assert.rejects(
        async () =>
          await createFryShare(
            memberId2,
            caresGroupId,
            "Someone",
            null,
            null,
            "2025-01-01",
            null
          ),
        /You must have this species registered for CARES to record a fry share/
      );
    });

    void test("should throw for unregistered species group", async () => {
      await assert.rejects(
        async () =>
          await createFryShare(
            memberId1,
            nonCaresGroupId,
            "Someone",
            null,
            null,
            "2025-01-01",
            null
          ),
        /You must have this species registered for CARES to record a fry share/
      );
    });

    void test("should throw if collection entry was removed", async () => {
      await db.run(
        "UPDATE species_collection SET removed_date = CURRENT_DATE WHERE id = ?",
        caresCollectionId
      );

      await assert.rejects(
        async () =>
          await createFryShare(
            memberId1,
            caresGroupId,
            "Someone",
            null,
            null,
            "2025-01-01",
            null
          ),
        /You must have this species registered for CARES to record a fry share/
      );
    });
  });

  void describe("getCaresStats", () => {
    void test("should return zero counts when no CARES species in collections", async () => {
      // Remove the default CARES entry from beforeEach, add only a non-CARES species
      await db.run("DELETE FROM species_collection WHERE id = ?", caresCollectionId);
      await db.run(
        "INSERT INTO species_collection (member_id, group_id) VALUES (?, ?)",
        [memberId1, nonCaresGroupId]
      );

      const stats = await getCaresStats();
      assert.equal(stats.speciesCount, 0);
      assert.equal(stats.memberCount, 0);
    });

    void test("should count distinct CARES species being maintained", async () => {
      // member1 already has caresGroupId in collection (from beforeEach)
      // member2 also adds the same CARES species
      await db.run(
        "INSERT INTO species_collection (member_id, group_id) VALUES (?, ?)",
        [memberId2, caresGroupId]
      );

      const stats = await getCaresStats();
      assert.equal(stats.speciesCount, 1); // 1 distinct species
      assert.equal(stats.memberCount, 2); // 2 distinct members
    });

    void test("should count distinct members maintaining CARES species", async () => {
      // Add another CARES species and give it to member2
      const caresSpecies2 = await db.run(`
        INSERT INTO species_name_group (
          program_class, species_type, canonical_genus, canonical_species_name,
          base_points, is_cares_species
        ) VALUES ('Killifish', 'Fish', 'KilliGenus', 'killispecies', 15, 1)
      `);
      const caresGroupId2 = caresSpecies2.lastID as number;

      await db.run(
        "INSERT INTO species_collection (member_id, group_id) VALUES (?, ?)",
        [memberId2, caresGroupId2]
      );

      const stats = await getCaresStats();
      assert.equal(stats.speciesCount, 2); // 2 distinct CARES species
      assert.equal(stats.memberCount, 2); // 2 distinct members
    });

    void test("should not count removed entries", async () => {
      await db.run(
        "UPDATE species_collection SET removed_date = CURRENT_DATE WHERE id = ?",
        caresCollectionId
      );

      const stats = await getCaresStats();
      assert.equal(stats.speciesCount, 0);
      assert.equal(stats.memberCount, 0);
    });

    void test("should return zero when database is empty of CARES collections", async () => {
      // Remove the default collection entry from beforeEach
      await db.run("DELETE FROM species_collection");

      const stats = await getCaresStats();
      assert.equal(stats.speciesCount, 0);
      assert.equal(stats.memberCount, 0);
    });
  });

  void describe("isMemberCaresParticipant", () => {
    void test("should return false for member with no collection entries", async () => {
      const result = await isMemberCaresParticipant(memberId2);
      assert.equal(result, false);
    });

    void test("should return false for member with only non-CARES species", async () => {
      await db.run(
        "INSERT INTO species_collection (member_id, group_id) VALUES (?, ?)",
        [memberId2, nonCaresGroupId]
      );

      const result = await isMemberCaresParticipant(memberId2);
      assert.equal(result, false);
    });

    void test("should return true for member with a CARES species in collection", async () => {
      // member1 has caresGroupId in collection from beforeEach
      const result = await isMemberCaresParticipant(memberId1);
      assert.equal(result, true);
    });

    void test("should return false when CARES collection entry is removed", async () => {
      await db.run(
        "UPDATE species_collection SET removed_date = CURRENT_DATE WHERE id = ?",
        caresCollectionId
      );

      const result = await isMemberCaresParticipant(memberId1);
      assert.equal(result, false);
    });
  });

  void describe("getMemberCaresCount", () => {
    void test("should return 0 for member with no CARES species", async () => {
      const count = await getMemberCaresCount(memberId2);
      assert.equal(count, 0);
    });

    void test("should return 0 for member with only non-CARES species", async () => {
      await db.run(
        "INSERT INTO species_collection (member_id, group_id) VALUES (?, ?)",
        [memberId2, nonCaresGroupId]
      );

      const count = await getMemberCaresCount(memberId2);
      assert.equal(count, 0);
    });

    void test("should return count of CARES species maintained", async () => {
      // member1 has 1 CARES species already
      const count = await getMemberCaresCount(memberId1);
      assert.equal(count, 1);
    });

    void test("should count multiple CARES species", async () => {
      const caresSpecies2 = await db.run(`
        INSERT INTO species_name_group (
          program_class, species_type, canonical_genus, canonical_species_name,
          base_points, is_cares_species
        ) VALUES ('Killifish', 'Fish', 'KilliGenus', 'killispecies', 15, 1)
      `);
      await db.run(
        "INSERT INTO species_collection (member_id, group_id) VALUES (?, ?)",
        [memberId1, caresSpecies2.lastID as number]
      );

      const count = await getMemberCaresCount(memberId1);
      assert.equal(count, 2);
    });

    void test("should not count removed CARES entries", async () => {
      await db.run(
        "UPDATE species_collection SET removed_date = CURRENT_DATE WHERE id = ?",
        caresCollectionId
      );

      const count = await getMemberCaresCount(memberId1);
      assert.equal(count, 0);
    });

    void test("should not count non-CARES species even if in collection", async () => {
      await db.run(
        "INSERT INTO species_collection (member_id, group_id) VALUES (?, ?)",
        [memberId1, nonCaresGroupId]
      );

      const count = await getMemberCaresCount(memberId1);
      assert.equal(count, 1); // Only the CARES species, not the non-CARES one
    });
  });
});
