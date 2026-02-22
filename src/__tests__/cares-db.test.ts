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
  let collectionId1: number; // member1's CARES-eligible collection entry
  let collectionId2: number; // member1's non-CARES collection entry

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
      ["Alice", "alice@test.com"]
    );
    memberId1 = member1.lastID as number;

    const member2 = await db.run(
      "INSERT INTO members (display_name, contact_email) VALUES (?, ?)",
      ["Bob", "bob@test.com"]
    );
    memberId2 = member2.lastID as number;

    // Create a CARES species
    const caresSpecies = await db.run(
      `INSERT INTO species_name_group (
        program_class, species_type, canonical_genus, canonical_species_name,
        base_points, is_cares_species
      ) VALUES ('Cichlids', 'Fish', 'Xystichromis', 'phytophagus', 10, 1)`
    );
    caresGroupId = caresSpecies.lastID as number;

    await db.run(
      "INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)",
      [caresGroupId, "Christmas Fulu"]
    );

    // Create a non-CARES species
    const nonCaresSpecies = await db.run(
      `INSERT INTO species_name_group (
        program_class, species_type, canonical_genus, canonical_species_name,
        base_points, is_cares_species
      ) VALUES ('Livebearers', 'Fish', 'Poecilia', 'reticulata', 5, 0)`
    );
    nonCaresGroupId = nonCaresSpecies.lastID as number;

    await db.run(
      "INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)",
      [nonCaresGroupId, "Guppy"]
    );

    // Add collection entries for member1
    const col1 = await db.run(
      `INSERT INTO species_collection (member_id, group_id, visibility)
       VALUES (?, ?, 'public')`,
      [memberId1, caresGroupId]
    );
    collectionId1 = col1.lastID as number;

    const col2 = await db.run(
      `INSERT INTO species_collection (member_id, group_id, visibility)
       VALUES (?, ?, 'public')`,
      [memberId1, nonCaresGroupId]
    );
    collectionId2 = col2.lastID as number;
  });

  afterEach(async () => {
    await db.close();
  });

  // ── registerForCares ──────────────────────────────────────────────

  void describe("registerForCares", () => {
    void test("should register a CARES-eligible collection entry", async () => {
      await registerForCares(collectionId1, memberId1, "photo-key-1", "https://r2.example.com/photo-key-1");

      const entry = await db.get(
        "SELECT cares_registered_at, cares_photo_key, cares_photo_url FROM species_collection WHERE id = ?",
        collectionId1
      );
      assert.ok(entry.cares_registered_at, "Should set cares_registered_at");
      assert.equal(entry.cares_photo_key, "photo-key-1");
      assert.equal(entry.cares_photo_url, "https://r2.example.com/photo-key-1");
    });

    void test("should reject non-existent collection entry", async () => {
      await assert.rejects(
        () => registerForCares(99999, memberId1, "key", "url"),
        /Collection entry not found or access denied/
      );
    });

    void test("should reject if member does not own the entry", async () => {
      await assert.rejects(
        () => registerForCares(collectionId1, memberId2, "key", "url"),
        /Collection entry not found or access denied/
      );
    });

    void test("should reject non-CARES species", async () => {
      await assert.rejects(
        () => registerForCares(collectionId2, memberId1, "key", "url"),
        /not part of the CARES priority list/
      );
    });

    void test("should reject already-registered entry", async () => {
      await registerForCares(collectionId1, memberId1, "key", "url");

      await assert.rejects(
        () => registerForCares(collectionId1, memberId1, "key2", "url2"),
        /already registered for CARES/
      );
    });

    void test("should reject entry with no group_id", async () => {
      // Create a collection entry without a group_id (custom species)
      const col = await db.run(
        `INSERT INTO species_collection (member_id, common_name, visibility)
         VALUES (?, 'Custom Fish', 'public')`,
        [memberId1]
      );

      await assert.rejects(
        () => registerForCares(col.lastID as number, memberId1, "key", "url"),
        /Only species linked to the database can be registered/
      );
    });

    void test("should reject removed collection entry", async () => {
      await db.run(
        "UPDATE species_collection SET removed_date = CURRENT_DATE WHERE id = ?",
        [collectionId1]
      );

      await assert.rejects(
        () => registerForCares(collectionId1, memberId1, "key", "url"),
        /Collection entry not found or access denied/
      );
    });
  });

  // ── updateCaresPhoto ──────────────────────────────────────────────

  void describe("updateCaresPhoto", () => {
    beforeEach(async () => {
      // Register the entry for CARES first
      await registerForCares(collectionId1, memberId1, "old-key", "https://r2.example.com/old-key");
    });

    void test("should update the photo and return old key", async () => {
      const result = await updateCaresPhoto(
        collectionId1, memberId1, "new-key", "https://r2.example.com/new-key"
      );

      assert.equal(result.oldPhotoKey, "old-key");

      const entry = await db.get(
        "SELECT cares_photo_key, cares_photo_url FROM species_collection WHERE id = ?",
        collectionId1
      );
      assert.equal(entry.cares_photo_key, "new-key");
      assert.equal(entry.cares_photo_url, "https://r2.example.com/new-key");
    });

    void test("should reject non-existent collection entry", async () => {
      await assert.rejects(
        () => updateCaresPhoto(99999, memberId1, "key", "url"),
        /Collection entry not found or access denied/
      );
    });

    void test("should reject if member does not own the entry", async () => {
      await assert.rejects(
        () => updateCaresPhoto(collectionId1, memberId2, "key", "url"),
        /Collection entry not found or access denied/
      );
    });

    void test("should reject if entry is not CARES-registered", async () => {
      await assert.rejects(
        () => updateCaresPhoto(collectionId2, memberId1, "key", "url"),
        /not registered for CARES/
      );
    });
  });

  // ── getCaresEligibility ───────────────────────────────────────────

  void describe("getCaresEligibility", () => {
    void test("should return eligible=true, registered=false for unregistered CARES species", async () => {
      const result = await getCaresEligibility(collectionId1, memberId1);
      assert.ok(result);
      assert.equal(result.eligible, true);
      assert.equal(result.registered, false);
      assert.equal(result.photoUrl, null);
    });

    void test("should return eligible=true, registered=true after registration", async () => {
      await registerForCares(collectionId1, memberId1, "key", "https://photo.url");

      const result = await getCaresEligibility(collectionId1, memberId1);
      assert.ok(result);
      assert.equal(result.eligible, true);
      assert.equal(result.registered, true);
      assert.equal(result.photoUrl, "https://photo.url");
    });

    void test("should return eligible=false for non-CARES species", async () => {
      const result = await getCaresEligibility(collectionId2, memberId1);
      assert.ok(result);
      assert.equal(result.eligible, false);
      assert.equal(result.registered, false);
    });

    void test("should return null for non-existent entry", async () => {
      const result = await getCaresEligibility(99999, memberId1);
      assert.equal(result, null);
    });

    void test("should return null if member does not own the entry", async () => {
      const result = await getCaresEligibility(collectionId1, memberId2);
      assert.equal(result, null);
    });
  });

  // ── getCaresProfile ───────────────────────────────────────────────

  void describe("getCaresProfile", () => {
    void test("should return empty profile when member has no CARES registrations", async () => {
      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.registrations.length, 0);
      assert.equal(profile.articles.length, 0);
      assert.equal(profile.fryShares.length, 0);
    });

    void test("should return registrations with species details", async () => {
      await registerForCares(collectionId1, memberId1, "key", "https://photo.url");

      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.registrations.length, 1);

      const reg = profile.registrations[0];
      assert.equal(reg.collection_id, collectionId1);
      assert.equal(reg.group_id, caresGroupId);
      assert.equal(reg.common_name, "Christmas Fulu");
      assert.equal(reg.scientific_name, "Xystichromis phytophagus");
      assert.ok(reg.cares_registered_at);
    });

    void test("should compute seal flags correctly", async () => {
      await registerForCares(collectionId1, memberId1, "key", "https://photo.url");

      // Add images to the collection entry
      await db.run(
        "UPDATE species_collection SET images = ? WHERE id = ?",
        [JSON.stringify([{ key: "img.jpg", url: "https://example.com/img.jpg", size: 100 }]), collectionId1]
      );

      // Add an article
      await db.run(
        `INSERT INTO cares_article (member_id, species_group_id, title, published_date)
         VALUES (?, ?, 'My Article', '2025-01-15')`,
        [memberId1, caresGroupId]
      );

      // Add an internal fry share (has recipient_member_id)
      await db.run(
        `INSERT INTO cares_fry_share (member_id, species_group_id, recipient_name, recipient_member_id, share_date)
         VALUES (?, ?, 'Bob', ?, '2025-02-01')`,
        [memberId1, caresGroupId, memberId2]
      );

      // Add an external fry share (has recipient_club, no recipient_member_id)
      await db.run(
        `INSERT INTO cares_fry_share (member_id, species_group_id, recipient_name, recipient_club, share_date)
         VALUES (?, ?, 'External Person', 'Other Club', '2025-03-01')`,
        [memberId1, caresGroupId]
      );

      const profile = await getCaresProfile(memberId1);
      const reg = profile.registrations[0];

      assert.equal(reg.has_photo, true);
      assert.equal(reg.has_article, true);
      assert.equal(reg.has_internal_share, true);
      assert.equal(reg.has_external_share, true);
      assert.equal(reg.article_count, 1);
      assert.equal(reg.fry_share_count, 2);
    });

    void test("should compute is_longevity when confirmed for 2+ years", async () => {
      await registerForCares(collectionId1, memberId1, "key", "https://photo.url");

      // Set registration date to 3 years ago and confirmation to now
      const threeYearsAgo = new Date();
      threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
      await db.run(
        "UPDATE species_collection SET cares_registered_at = ?, cares_last_confirmed = CURRENT_DATE WHERE id = ?",
        [threeYearsAgo.toISOString(), collectionId1]
      );

      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.registrations[0].is_longevity, true);
    });

    void test("should return is_longevity=false when confirmed for less than 2 years", async () => {
      await registerForCares(collectionId1, memberId1, "key", "https://photo.url");

      // Set confirmation just 1 year after registration
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      await db.run(
        "UPDATE species_collection SET cares_registered_at = ?, cares_last_confirmed = CURRENT_DATE WHERE id = ?",
        [oneYearAgo.toISOString(), collectionId1]
      );

      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.registrations[0].is_longevity, false);
    });

    void test("should return articles with species details", async () => {
      await db.run(
        `INSERT INTO cares_article (member_id, species_group_id, title, url, published_date)
         VALUES (?, ?, 'Breeding Christmas Fulu', 'https://example.com/article', '2025-06-01')`,
        [memberId1, caresGroupId]
      );

      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.articles.length, 1);
      assert.equal(profile.articles[0].title, "Breeding Christmas Fulu");
      assert.equal(profile.articles[0].url, "https://example.com/article");
      assert.equal(profile.articles[0].species_common_name, "Christmas Fulu");
      assert.equal(profile.articles[0].species_scientific_name, "Xystichromis phytophagus");
    });

    void test("should return fry shares with species details and is_external flag", async () => {
      // Internal share
      await db.run(
        `INSERT INTO cares_fry_share (member_id, species_group_id, recipient_name, recipient_member_id, share_date, notes)
         VALUES (?, ?, 'Bob', ?, '2025-04-01', 'Nice fish')`,
        [memberId1, caresGroupId, memberId2]
      );

      // External share
      await db.run(
        `INSERT INTO cares_fry_share (member_id, species_group_id, recipient_name, recipient_club, share_date)
         VALUES (?, ?, 'External Joe', 'Other Club', '2025-05-01')`,
        [memberId1, caresGroupId]
      );

      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.fryShares.length, 2);

      // Ordered by share_date DESC
      const external = profile.fryShares[0];
      assert.equal(external.recipient_name, "External Joe");
      assert.equal(external.recipient_club, "Other Club");
      assert.equal(external.is_external, true);

      const internal = profile.fryShares[1];
      assert.equal(internal.recipient_name, "Bob");
      assert.equal(internal.is_external, false);
      assert.equal(internal.notes, "Nice fish");
    });

    void test("should not include removed collection entries", async () => {
      await registerForCares(collectionId1, memberId1, "key", "url");
      await db.run(
        "UPDATE species_collection SET removed_date = CURRENT_DATE WHERE id = ?",
        [collectionId1]
      );

      const profile = await getCaresProfile(memberId1);
      assert.equal(profile.registrations.length, 0);
    });
  });

  // ── getCaresRegistrations ─────────────────────────────────────────

  void describe("getCaresRegistrations", () => {
    void test("should return empty array when no CARES registrations", async () => {
      const regs = await getCaresRegistrations(memberId1);
      assert.equal(regs.length, 0);
    });

    void test("should return registered species with names", async () => {
      await registerForCares(collectionId1, memberId1, "key", "url");

      const regs = await getCaresRegistrations(memberId1);
      assert.equal(regs.length, 1);
      assert.equal(regs[0].collection_id, collectionId1);
      assert.equal(regs[0].group_id, caresGroupId);
      assert.equal(regs[0].common_name, "Christmas Fulu");
      assert.equal(regs[0].scientific_name, "Xystichromis phytophagus");
    });

    void test("should not include removed entries", async () => {
      await registerForCares(collectionId1, memberId1, "key", "url");
      await db.run(
        "UPDATE species_collection SET removed_date = CURRENT_DATE WHERE id = ?",
        [collectionId1]
      );

      const regs = await getCaresRegistrations(memberId1);
      assert.equal(regs.length, 0);
    });

    void test("should not include other members' registrations", async () => {
      // Give member2 a collection entry and register it
      const col = await db.run(
        `INSERT INTO species_collection (member_id, group_id, visibility)
         VALUES (?, ?, 'public')`,
        [memberId2, caresGroupId]
      );
      await registerForCares(col.lastID as number, memberId2, "key", "url");

      const regs = await getCaresRegistrations(memberId1);
      assert.equal(regs.length, 0);
    });
  });

  // ── createFryShare ────────────────────────────────────────────────

  void describe("createFryShare", () => {
    beforeEach(async () => {
      await registerForCares(collectionId1, memberId1, "key", "url");
    });

    void test("should create an internal fry share", async () => {
      const id = await createFryShare(
        memberId1, caresGroupId, "Bob", memberId2, null, "2025-06-01", "Healthy fry"
      );

      assert.ok(id > 0);

      const row = await db.get("SELECT * FROM cares_fry_share WHERE id = ?", id);
      assert.equal(row.member_id, memberId1);
      assert.equal(row.species_group_id, caresGroupId);
      assert.equal(row.recipient_name, "Bob");
      assert.equal(row.recipient_member_id, memberId2);
      assert.equal(row.recipient_club, null);
      assert.equal(row.share_date, "2025-06-01");
      assert.equal(row.notes, "Healthy fry");
    });

    void test("should create an external fry share", async () => {
      const id = await createFryShare(
        memberId1, caresGroupId, "External Person", null, "Other Club", "2025-07-01", null
      );

      assert.ok(id > 0);

      const row = await db.get("SELECT * FROM cares_fry_share WHERE id = ?", id);
      assert.equal(row.recipient_club, "Other Club");
      assert.equal(row.recipient_member_id, null);
      assert.equal(row.notes, null);
    });

    void test("should reject if species is not CARES-registered", async () => {
      await assert.rejects(
        () => createFryShare(
          memberId1, nonCaresGroupId, "Bob", memberId2, null, "2025-06-01", null
        ),
        /must have this species registered for CARES/
      );
    });

    void test("should reject if member has no registration for the species", async () => {
      await assert.rejects(
        () => createFryShare(
          memberId2, caresGroupId, "Alice", memberId1, null, "2025-06-01", null
        ),
        /must have this species registered for CARES/
      );
    });
  });

  // ── getCaresStats ─────────────────────────────────────────────────

  void describe("getCaresStats", () => {
    void test("should return zero counts when no one keeps CARES species", async () => {
      // Remove the CARES collection entry
      await db.run(
        "UPDATE species_collection SET removed_date = CURRENT_DATE WHERE id = ?",
        [collectionId1]
      );

      const stats = await getCaresStats();
      assert.equal(stats.speciesCount, 0);
      assert.equal(stats.memberCount, 0);
    });

    void test("should count distinct species and members", async () => {
      // member1 already has the CARES species in collection
      // Give member2 the same CARES species
      await db.run(
        `INSERT INTO species_collection (member_id, group_id, visibility)
         VALUES (?, ?, 'public')`,
        [memberId2, caresGroupId]
      );

      const stats = await getCaresStats();
      assert.equal(stats.speciesCount, 1); // one distinct CARES species
      assert.equal(stats.memberCount, 2); // two members keeping it
    });

    void test("should not count removed entries", async () => {
      await db.run(
        "UPDATE species_collection SET removed_date = CURRENT_DATE WHERE id = ?",
        [collectionId1]
      );

      const stats = await getCaresStats();
      assert.equal(stats.memberCount, 0);
    });

    void test("should count multiple CARES species", async () => {
      // Create another CARES species
      const sp2 = await db.run(
        `INSERT INTO species_name_group (
          program_class, species_type, canonical_genus, canonical_species_name,
          base_points, is_cares_species
        ) VALUES ('Cichlids', 'Fish', 'Haplochromis', 'obliquidens', 10, 1)`
      );

      await db.run(
        `INSERT INTO species_collection (member_id, group_id, visibility)
         VALUES (?, ?, 'public')`,
        [memberId1, sp2.lastID as number]
      );

      const stats = await getCaresStats();
      assert.equal(stats.speciesCount, 2);
      assert.equal(stats.memberCount, 1); // same member keeps both
    });
  });

  // ── isMemberCaresParticipant ──────────────────────────────────────

  void describe("isMemberCaresParticipant", () => {
    void test("should return true when member keeps a CARES species", async () => {
      const result = await isMemberCaresParticipant(memberId1);
      assert.equal(result, true);
    });

    void test("should return false when member has no CARES species", async () => {
      const result = await isMemberCaresParticipant(memberId2);
      assert.equal(result, false);
    });

    void test("should return false when CARES entry is removed", async () => {
      await db.run(
        "UPDATE species_collection SET removed_date = CURRENT_DATE WHERE id = ?",
        [collectionId1]
      );

      const result = await isMemberCaresParticipant(memberId1);
      assert.equal(result, false);
    });

    void test("should return false for non-existent member", async () => {
      const result = await isMemberCaresParticipant(99999);
      assert.equal(result, false);
    });
  });

  // ── getMemberCaresCount ───────────────────────────────────────────

  void describe("getMemberCaresCount", () => {
    void test("should return count of CARES species kept", async () => {
      const count = await getMemberCaresCount(memberId1);
      assert.equal(count, 1);
    });

    void test("should return 0 when member has no CARES species", async () => {
      const count = await getMemberCaresCount(memberId2);
      assert.equal(count, 0);
    });

    void test("should not count removed entries", async () => {
      await db.run(
        "UPDATE species_collection SET removed_date = CURRENT_DATE WHERE id = ?",
        [collectionId1]
      );

      const count = await getMemberCaresCount(memberId1);
      assert.equal(count, 0);
    });

    void test("should count multiple CARES species", async () => {
      // Create another CARES species and add to member1's collection
      const sp2 = await db.run(
        `INSERT INTO species_name_group (
          program_class, species_type, canonical_genus, canonical_species_name,
          base_points, is_cares_species
        ) VALUES ('Cichlids', 'Fish', 'Haplochromis', 'obliquidens', 10, 1)`
      );

      await db.run(
        `INSERT INTO species_collection (member_id, group_id, visibility)
         VALUES (?, ?, 'public')`,
        [memberId1, sp2.lastID as number]
      );

      const count = await getMemberCaresCount(memberId1);
      assert.equal(count, 2);
    });

    void test("should not count non-CARES species", async () => {
      // member1 also has non-CARES species in collection (collectionId2)
      const count = await getMemberCaresCount(memberId1);
      assert.equal(count, 1); // only the CARES one
    });

    void test("should return 0 for non-existent member", async () => {
      const count = await getMemberCaresCount(99999);
      assert.equal(count, 0);
    });
  });
});
