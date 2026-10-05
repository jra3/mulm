import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  registerForCares,
  updateCaresPhoto,
  getCaresEligibility,
  getCaresProfile,
  getCaresRegistrations,
  createFryShare,
  isMemberCaresParticipant,
} from "@/db/cares";
import {
  addToCollection,
  removeFromCollection,
  updateCollectionEntry,
  getCollectionForMember,
} from "@/db/collection";
import { createMember } from "@/db/members";
import { setupTestDatabase, type TestDatabase } from "./testDbHelper.helper";

/**
 * A CARES registration belongs to the member and Species, not to the
 * collection entry it was made from: editing, removing or re-adding the entry
 * leaves it where it is.
 */
void describe("CARES registration", () => {
  let testDb: TestDatabase;
  let memberId: number;
  let caresSpecies: number;
  let otherSpecies: number;

  async function insertSpecies(epithet: string, isCares: boolean): Promise<number> {
    const result = await testDb.db.run(
      `INSERT INTO species_name_group
         (program_class, species_type, canonical_genus, canonical_species_name, is_cares_species)
       VALUES ('Livebearers', 'Fish', 'Testcaresus', ?, ?)`,
      [epithet, isCares ? 1 : 0]
    );
    return result.lastID as number;
  }

  beforeEach(async () => {
    testDb = await setupTestDatabase();
    memberId = await createMember("keeper@example.com", "Keeper");
    caresSpecies = await insertSpecies("doadrioi", true);
    otherSpecies = await insertSpecies("eiseni", false);
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  async function registeredEntry(): Promise<number> {
    const entryId = await addToCollection(memberId, { group_id: caresSpecies });
    await registerForCares(
      entryId,
      memberId,
      "cares/1-original.jpg",
      "https://r2/cares/1-original.jpg"
    );
    return entryId;
  }

  void test("registers the Species of an entry with its photo", async () => {
    const entryId = await registeredEntry();

    assert.deepStrictEqual(await getCaresEligibility(entryId, memberId), {
      eligible: true,
      registered: true,
      photoUrl: "https://r2/cares/1-original.jpg",
    });
    const [entry] = await getCollectionForMember(memberId, {
      viewerId: memberId,
      includeCaresRegistry: true,
    });
    assert.ok(entry.cares_registered_at);
    assert.strictEqual(entry.cares_photo_url, "https://r2/cares/1-original.jpg");
  });

  void test("refuses a second registration for the same Species", async () => {
    const entryId = await registeredEntry();
    await assert.rejects(() => registerForCares(entryId, memberId, "k", "u"), /already registered/);
  });

  void test("refuses a Species not on the CARES list", async () => {
    const entryId = await addToCollection(memberId, { group_id: otherSpecies });
    await assert.rejects(
      () => registerForCares(entryId, memberId, "k", "u"),
      /not part of the CARES/
    );
  });

  void test("survives an edit of the entry's names", async () => {
    const entryId = await registeredEntry();
    await updateCollectionEntry(entryId, memberId, {
      common_name: "Splitfin",
      scientific_name: "Testcaresus doadrioi",
    });

    assert.strictEqual((await getCaresRegistrations(memberId)).length, 1);
  });

  void test("survives removing the entry, and shows again when the Species is re-added", async () => {
    const entryId = await registeredEntry();
    await removeFromCollection(entryId, memberId);

    const profile = await getCaresProfile(memberId);
    assert.strictEqual(profile.registrations.length, 1);
    assert.strictEqual(await isMemberCaresParticipant(memberId), true);

    const readded = await addToCollection(memberId, { group_id: caresSpecies });
    assert.strictEqual((await getCaresEligibility(readded, memberId))?.registered, true);
    const current = await getCollectionForMember(memberId, {
      viewerId: memberId,
      includeCaresRegistry: true,
    });
    assert.ok(current[0].cares_registered_at);
  });

  void test("a removed entry does not show the registration", async () => {
    const entryId = await registeredEntry();
    await removeFromCollection(entryId, memberId);

    const [removed] = await getCollectionForMember(memberId, {
      viewerId: memberId,
      includeRemoved: true,
      includeCaresRegistry: true,
    });
    assert.strictEqual(removed.cares_registered_at, null);
  });

  void test("the Gold seal comes from the registration photo, not collection images", async () => {
    await registeredEntry();

    const [registration] = (await getCaresProfile(memberId)).registrations;
    assert.strictEqual(registration.has_photo, true);
    assert.strictEqual(registration.photo_url, "https://r2/cares/1-original.jpg");
  });

  void test("replacing the photo hands back the old key for cleanup", async () => {
    const entryId = await registeredEntry();

    const { oldPhotoKey } = await updateCaresPhoto(entryId, memberId, "cares/2-original.jpg", "u2");
    assert.strictEqual(oldPhotoKey, "cares/1-original.jpg");
    assert.strictEqual((await getCaresEligibility(entryId, memberId))?.photoUrl, "u2");
  });

  void test("a fry share needs a registration, not a collection entry", async () => {
    await assert.rejects(
      () => createFryShare(memberId, caresSpecies, "Friend", null, null, "2026-01-01", null),
      /must have this species registered/
    );

    const entryId = await registeredEntry();
    await removeFromCollection(entryId, memberId);
    await createFryShare(memberId, caresSpecies, "Friend", null, "Other Club", "2026-01-01", null);

    const [registration] = (await getCaresProfile(memberId)).registrations;
    assert.strictEqual(registration.has_external_share, true);
  });

  void test("keeping a CARES Species without registering it is not participating", async () => {
    await addToCollection(memberId, { group_id: caresSpecies });
    assert.strictEqual(await isMemberCaresParticipant(memberId), false);
  });
});
