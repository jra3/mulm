import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  createMember,
  getGoogleAccount,
  getMember,
  getMemberByEmail,
  getMembersList,
  getRosterWithPoints,
} from "../db/members";
import { createSubmission, approveSubmission } from "../db/submissions";
import { getErrorMessage } from "../utils/error";
import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestSpeciesName,
  type TestContext,
} from "./helpers/testHelpers";

void describe("Member Management", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase(); // Creates 1 admin + 1 regular member
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void test("Members list append", async () => {
    const initialCount = (await getMembersList()).length;
    await createMember("honk@dazzle.com", "Honk Dazzle");
    assert.strictEqual((await getMembersList()).length, initialCount + 1);
  });

  void test("Create and fetch", async () => {
    const id = await createMember("honk@dazzle.com", "Honk Dazzle");
    assert.strictEqual((await getMemberByEmail("honk@dazzle.com"))?.id, id);
    assert.strictEqual((await getMemberByEmail("honk@dazzle.com"))?.id, id);
    assert.strictEqual((await getMember(id))?.display_name, "Honk Dazzle");
    assert.strictEqual(await getMember(1234), undefined);
  });

  void test("Create COLLISION", async () => {
    const initialCount = (await getMembersList()).length;
    await createMember("nop@nopsledteam.com", "hehehehe");
    await createMember("honk@dazzle.com", "Honk Dazzle");
    try {
      await createMember("honk@dazzle.com", "Dude Perfect");
      throw new Error("Should have thrown");
    } catch (e: unknown) {
      assert.strictEqual(getErrorMessage(e), "Failed to create member");
    }
    assert.strictEqual((await getMembersList()).length, initialCount + 2);
  });

  void test("Create with google", async () => {
    const id = await createMember("honk@dazzle.com", "Honk Dazzle", { google_sub: "123456789" });
    const acct = await getGoogleAccount("123456789");
    assert.strictEqual(acct?.member_id, id);

    if (!acct) {
      throw new Error("Failed to retrieve Google account for test");
    }

    assert.strictEqual((await getMember(acct.member_id))?.display_name, "Honk Dazzle");
  });

  void test("Create with google COLLISION", async () => {
    const initialCount = (await getMembersList()).length;
    await createMember("nop@nopsledteam.com", "hehehehe", { google_sub: "987654321" });
    await createMember("honk@dazzle.com", "Honk Dazzle", { google_sub: "123456789" });
    try {
      await createMember("wummper@dazzle.com", "Dude Perfect", { google_sub: "123456789" });
      throw new Error("Should have thrown");
    } catch (err: unknown) {
      assert.strictEqual(getErrorMessage(err), "Failed to create member");
    }
    assert.strictEqual((await getMembersList()).length, initialCount + 2);
  });
});

void describe("getRosterWithPoints", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void test("returns empty roster when no members exist", async () => {
    // Remove all members
    await ctx.db.run("DELETE FROM members");
    const roster = await getRosterWithPoints();
    assert.deepStrictEqual(roster, []);
  });

  void test("returns members with zero points when no submissions exist", async () => {
    const member1Id = await createMember("fish@test.com", "Fish Keeper");
    const member2Id = await createMember("plant@test.com", "Plant Grower");

    const roster = await getRosterWithPoints();
    assert.strictEqual(roster.length >= 2, true); // At least our 2 new members

    const member1 = roster.find((m) => m.id === member1Id);
    const member2 = roster.find((m) => m.id === member2Id);

    assert.ok(member1);
    assert.strictEqual(member1.display_name, "Fish Keeper");
    assert.strictEqual(member1.contact_email, "fish@test.com");
    assert.strictEqual(member1.fishTotalPoints, 0);
    assert.strictEqual(member1.plantTotalPoints, 0);
    assert.strictEqual(member1.coralTotalPoints, 0);

    assert.ok(member2);
    assert.strictEqual(member2.display_name, "Plant Grower");
    assert.strictEqual(member2.contact_email, "plant@test.com");
    assert.strictEqual(member2.fishTotalPoints, 0);
    assert.strictEqual(member2.plantTotalPoints, 0);
    assert.strictEqual(member2.coralTotalPoints, 0);
  });

  void test("calculates fish program points correctly", async () => {
    const adminId = await createMember("admin@test.com", "Admin", {}, true);
    const memberId = await createMember("member@test.com", "Member");

    // Create and approve a fish submission
    const submissionId = await createSubmission(
      memberId,
      {
        species_type: "Fish",
        species_class: "Freshwater",
        species_common_name: "Guppy",
        species_latin_name: "Poecilia reticulata",
        water_type: "Fresh",
        count: "5",
        reproduction_date: "2024-01-01",
        foods: ["flakes"],
        spawn_locations: ["plants"],
        tank_size: "10",
        filter_type: "sponge",
        water_change_volume: "50%",
        water_change_frequency: "weekly",
        temperature: "75F",
        ph: "7.0",
      },
      true
    );

    const speciesNameId = await createTestSpeciesName(
      ctx.db,
      "Guppy",
      "Poecilia reticulata",
      "Poecilia",
      "reticulata",
      "Freshwater"
    );
    await approveSubmission(
      adminId,
      submissionId,
      { common_name_id: speciesNameId.common_name_id, scientific_name_id: speciesNameId.scientific_name_id },
      {
        id: submissionId,
        points: 10,
        article_points: 3,
        first_time_species: true,
        flowered: false,
        sexual_reproduction: false,
        group_id: speciesNameId.group_id,
        canonical_genus: "Poecilia",
        canonical_species_name: "reticulata",
      }
    );

    const roster = await getRosterWithPoints();
    const member = roster.find((m) => m.id === memberId);

    assert.ok(member);
    assert.strictEqual(member.fishTotalPoints, 18); // 10 + 3 + 5 (first time bonus)
    assert.strictEqual(member.plantTotalPoints, 0);
    assert.strictEqual(member.coralTotalPoints, 0);
  });

  void test("calculates plant program points with bonuses correctly", async () => {
    const adminId = await createMember("admin@test.com", "Admin", {}, true);
    const memberId = await createMember("member@test.com", "Member");

    // Create and approve a plant submission with flowered and sexual reproduction bonuses
    const submissionId = await createSubmission(
      memberId,
      {
        species_type: "Plant",
        species_class: "Stem",
        species_common_name: "Java Fern",
        species_latin_name: "Microsorum pteropus",
        water_type: "Fresh",
        count: "3",
        reproduction_date: "2024-01-01",
        foods: [],
        spawn_locations: [],
        tank_size: "20",
        filter_type: "canister",
        water_change_volume: "30%",
        water_change_frequency: "weekly",
        temperature: "72F",
        ph: "6.8",
        light_type: "LED",
        light_strength: "Medium",
        light_hours: "8",
      },
      true
    );

    const plantSpeciesNameId = await createTestSpeciesName(
      ctx.db,
      "Java Fern",
      "Microsorum pteropus",
      "Microsorum",
      "pteropus",
      "Stem"
    );
    await approveSubmission(
      adminId,
      submissionId,
      {
        common_name_id: plantSpeciesNameId.common_name_id,
        scientific_name_id: plantSpeciesNameId.scientific_name_id,
      },
      {
        id: submissionId,
        points: 8,
        article_points: 2,
        first_time_species: true,
        flowered: true,
        sexual_reproduction: true,
        group_id: plantSpeciesNameId.group_id,
        canonical_genus: "Microsorum",
        canonical_species_name: "pteropus",
      }
    );

    const roster = await getRosterWithPoints();
    const member = roster.find((m) => m.id === memberId);

    assert.ok(member);
    // 8 (base) + 2 (article) + 5 (first time) + 8 (flowered bonus) + 8 (sexual repro bonus) = 31
    assert.strictEqual(member.plantTotalPoints, 31);
    assert.strictEqual(member.fishTotalPoints, 0);
    assert.strictEqual(member.coralTotalPoints, 0);
  });

  void test("calculates coral program points correctly", async () => {
    const adminId = await createMember("admin@test.com", "Admin", {}, true);
    const memberId = await createMember("member@test.com", "Member");

    // Create and approve a coral submission
    const submissionId = await createSubmission(
      memberId,
      {
        species_type: "Coral",
        species_class: "SPS",
        species_common_name: "Acropora",
        species_latin_name: "Acropora millepora",
        water_type: "Salt",
        count: "2",
        reproduction_date: "2024-01-01",
        foods: ["zooplankton"],
        spawn_locations: ["rock"],
        tank_size: "50",
        filter_type: "protein skimmer",
        water_change_volume: "20%",
        water_change_frequency: "bi-weekly",
        temperature: "78F",
        ph: "8.2",
        specific_gravity: "1.025",
      },
      true
    );

    const coralSpeciesNameId = await createTestSpeciesName(
      ctx.db,
      "Acropora",
      "Acropora millepora",
      "Acropora",
      "millepora",
      "SPS"
    );
    await approveSubmission(
      adminId,
      submissionId,
      {
        common_name_id: coralSpeciesNameId.common_name_id,
        scientific_name_id: coralSpeciesNameId.scientific_name_id,
      },
      {
        id: submissionId,
        points: 15,
        article_points: 5,
        first_time_species: true,
        flowered: false, // Not applicable for coral
        sexual_reproduction: false, // Not applicable for coral
        group_id: coralSpeciesNameId.group_id,
        canonical_genus: "Acropora",
        canonical_species_name: "millepora",
      }
    );

    const roster = await getRosterWithPoints();
    const member = roster.find((m) => m.id === memberId);

    assert.ok(member);
    assert.strictEqual(member.coralTotalPoints, 25); // 15 + 5 + 5 (first time bonus)
    assert.strictEqual(member.fishTotalPoints, 0);
    assert.strictEqual(member.plantTotalPoints, 0);
  });

  void test("handles multiple submissions across different programs", async () => {
    const adminId = await createMember("admin@test.com", "Admin", {}, true);
    const memberId = await createMember("member@test.com", "Multi-Program Member");

    // Fish submission
    const fishSubmissionId = await createSubmission(
      memberId,
      {
        species_type: "Fish",
        species_class: "Freshwater",
        species_common_name: "Neon Tetra",
        species_latin_name: "Paracheirodon innesi",
        water_type: "Fresh",
        count: "20",
        reproduction_date: "2024-01-01",
        foods: ["micro pellets"],
        spawn_locations: ["moss"],
        tank_size: "20",
        filter_type: "sponge",
      },
      true
    );

    const fishSpeciesNameId = await createTestSpeciesName(
      ctx.db,
      "Neon Tetra",
      "Paracheirodon innesi",
      "Paracheirodon",
      "innesi",
      "Freshwater"
    );
    await approveSubmission(
      adminId,
      fishSubmissionId,
      {
        common_name_id: fishSpeciesNameId.common_name_id,
        scientific_name_id: fishSpeciesNameId.scientific_name_id,
      },
      {
        id: fishSubmissionId,
        points: 5,
        article_points: 0,
        first_time_species: false,
        flowered: false,
        sexual_reproduction: false,
        group_id: fishSpeciesNameId.group_id,
        canonical_genus: "Paracheirodon",
        canonical_species_name: "innesi",
      }
    );

    // Plant submission
    const plantSubmissionId = await createSubmission(
      memberId,
      {
        species_type: "Plant",
        species_class: "Rosette",
        species_common_name: "Amazon Sword",
        species_latin_name: "Echinodorus grisebachii",
        water_type: "Fresh",
        count: "1",
        reproduction_date: "2024-02-01",
        foods: [],
        spawn_locations: [],
        tank_size: "40",
        light_type: "LED",
      },
      true
    );

    const plantSpeciesNameId2 = await createTestSpeciesName(
      ctx.db,
      "Amazon Sword",
      "Echinodorus grisebachii",
      "Echinodorus",
      "grisebachii",
      "Rosette"
    );
    await approveSubmission(
      adminId,
      plantSubmissionId,
      {
        common_name_id: plantSpeciesNameId2.common_name_id,
        scientific_name_id: plantSpeciesNameId2.scientific_name_id,
      },
      {
        id: plantSubmissionId,
        points: 6,
        article_points: 1,
        first_time_species: true,
        flowered: false,
        sexual_reproduction: true,
        group_id: plantSpeciesNameId2.group_id,
        canonical_genus: "Echinodorus",
        canonical_species_name: "grisebachii",
      }
    );

    const roster = await getRosterWithPoints();
    const member = roster.find((m) => m.id === memberId);

    assert.ok(member);
    assert.strictEqual(member.fishTotalPoints, 5); // 5 + 0 + 0
    assert.strictEqual(member.plantTotalPoints, 18); // 6 + 1 + 5 + 0 + 6 (sexual repro bonus)
    assert.strictEqual(member.coralTotalPoints, 0);
  });

  void test("only includes approved submissions", async () => {
    const adminId = await createMember("admin@test.com", "Admin", {}, true);
    const memberId = await createMember("member@test.com", "Member");

    // Create submitted but not approved
    await createSubmission(
      memberId,
      {
        species_type: "Fish",
        species_class: "Freshwater",
        species_common_name: "Guppy",
        species_latin_name: "Poecilia reticulata",
        water_type: "Fresh",
        count: "5",
        reproduction_date: "2024-01-01",
        foods: ["flakes"],
        spawn_locations: ["plants"],
      },
      true
    );

    // Create approved submission
    const approvedSubmissionId = await createSubmission(
      memberId,
      {
        species_type: "Fish",
        species_class: "Freshwater",
        species_common_name: "Molly",
        species_latin_name: "Poecilia sphenops",
        water_type: "Fresh",
        count: "3",
        reproduction_date: "2024-01-02",
        foods: ["flakes"],
        spawn_locations: ["plants"],
      },
      true
    );

    const mollySpeciesNameId = await createTestSpeciesName(
      ctx.db,
      "Molly",
      "Poecilia sphenops",
      "Poecilia",
      "sphenops",
      "Freshwater"
    );
    await approveSubmission(
      adminId,
      approvedSubmissionId,
      {
        common_name_id: mollySpeciesNameId.common_name_id,
        scientific_name_id: mollySpeciesNameId.scientific_name_id,
      },
      {
        id: approvedSubmissionId,
        points: 7,
        article_points: 0,
        first_time_species: false,
        flowered: false,
        sexual_reproduction: false,
        group_id: mollySpeciesNameId.group_id,
        canonical_genus: "Poecilia",
        canonical_species_name: "sphenops",
      }
    );

    const roster = await getRosterWithPoints();
    const member = roster.find((m) => m.id === memberId);

    assert.ok(member);
    assert.strictEqual(member.fishTotalPoints, 7); // Only approved submission counted
  });

  void test("handles invertebrates as fish program", async () => {
    const adminId = await createMember("admin@test.com", "Admin", {}, true);
    const memberId = await createMember("member@test.com", "Member");

    const submissionId = await createSubmission(
      memberId,
      {
        species_type: "Invert",
        species_class: "Freshwater",
        species_common_name: "Cherry Shrimp",
        species_latin_name: "Neocaridina davidi",
        water_type: "Fresh",
        count: "10",
        reproduction_date: "2024-01-01",
        foods: ["algae"],
        spawn_locations: ["moss"],
      },
      true
    );

    const shrimpSpeciesNameId = await createTestSpeciesName(
      ctx.db,
      "Cherry Shrimp",
      "Neocaridina davidi",
      "Neocaridina",
      "davidi",
      "Freshwater"
    );
    await approveSubmission(
      adminId,
      submissionId,
      {
        common_name_id: shrimpSpeciesNameId.common_name_id,
        scientific_name_id: shrimpSpeciesNameId.scientific_name_id,
      },
      {
        id: submissionId,
        points: 4,
        article_points: 1,
        first_time_species: true,
        flowered: false,
        sexual_reproduction: false,
        group_id: shrimpSpeciesNameId.group_id,
        canonical_genus: "Neocaridina",
        canonical_species_name: "davidi",
      }
    );

    const roster = await getRosterWithPoints();
    const member = roster.find((m) => m.id === memberId);

    assert.ok(member);
    assert.strictEqual(member.fishTotalPoints, 10); // 4 + 1 + 5 (Invert counts as fish program)
    assert.strictEqual(member.plantTotalPoints, 0);
    assert.strictEqual(member.coralTotalPoints, 0);
  });
});
