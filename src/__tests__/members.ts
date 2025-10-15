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
import { useTestDatabase, createTestSpeciesName } from "./testDbHelper.helper";

const { getDb } = useTestDatabase();

test("Members list append", async () => {
  expect((await getMembersList()).length).toEqual(0);
  await createMember("honk@dazzle.com", "Honk Dazzle");
  expect((await getMembersList()).length).toEqual(1);
});

test("Create and fetch", async () => {
  const id = await createMember("honk@dazzle.com", "Honk Dazzle");
  expect((await getMemberByEmail("honk@dazzle.com"))?.id).toEqual(id);
  expect((await getMemberByEmail("honk@dazzle.com"))?.id).toEqual(id);
  expect((await getMember(id))?.display_name).toEqual("Honk Dazzle");
  expect(await getMember(1234)).toBeUndefined();
});

test("Create COLLISION", async () => {
  await createMember("nop@nopsledteam.com", "hehehehe");
  await createMember("honk@dazzle.com", "Honk Dazzle");
  try {
    await createMember("honk@dazzle.com", "Dude Perfect");
    fail("Should have thrown");
  } catch (e: unknown) {
    expect(getErrorMessage(e)).toEqual("Failed to create member");
  }
  expect((await getMembersList()).length).toEqual(2);
});

test("Create with google", async () => {
  const id = await createMember("honk@dazzle.com", "Honk Dazzle", { google_sub: "123456789" });
  const acct = await getGoogleAccount("123456789");
  expect(acct?.member_id).toEqual(id);

  if (!acct) {
    throw new Error("Failed to retrieve Google account for test");
  }

  expect((await getMember(acct.member_id))?.display_name).toEqual("Honk Dazzle");
});

test("Create with google COLLISION", async () => {
  await createMember("nop@nopsledteam.com", "hehehehe", { google_sub: "987654321" });
  await createMember("honk@dazzle.com", "Honk Dazzle", { google_sub: "123456789" });
  try {
    await createMember("wummper@dazzle.com", "Dude Perfect", { google_sub: "123456789" });
    fail("Should have thrown");
  } catch (err: unknown) {
    expect(getErrorMessage(err)).toEqual("Failed to create member");
  }
  expect((await getMembersList()).length).toEqual(2);
});

describe("getRosterWithPoints", () => {
  test("returns empty roster when no members exist", async () => {
    const roster = await getRosterWithPoints();
    expect(roster).toEqual([]);
  });

  test("returns members with zero points when no submissions exist", async () => {
    const member1Id = await createMember("fish@test.com", "Fish Keeper");
    const member2Id = await createMember("plant@test.com", "Plant Grower");

    const roster = await getRosterWithPoints();
    expect(roster).toHaveLength(2);

    const member1 = roster.find((m) => m.id === member1Id);
    const member2 = roster.find((m) => m.id === member2Id);

    expect(member1).toMatchObject({
      display_name: "Fish Keeper",
      contact_email: "fish@test.com",
      fishTotalPoints: 0,
      plantTotalPoints: 0,
      coralTotalPoints: 0,
    });

    expect(member2).toMatchObject({
      display_name: "Plant Grower",
      contact_email: "plant@test.com",
      fishTotalPoints: 0,
      plantTotalPoints: 0,
      coralTotalPoints: 0,
    });
  });

  test("calculates fish program points correctly", async () => {
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
      getDb(),
      "Guppy",
      "Poecilia reticulata",
      "Poecilia",
      "reticulata",
      "Freshwater"
    );
    await approveSubmission(adminId, submissionId, speciesNameId, {
      id: submissionId,
      points: 10,
      article_points: 3,
      first_time_species: true,
      flowered: false,
      sexual_reproduction: false,
      canonical_genus: "Poecilia",
      canonical_species_name: "reticulata",
    });

    const roster = await getRosterWithPoints();
    const member = roster.find((m) => m.id === memberId);

    expect(member?.fishTotalPoints).toBe(18); // 10 + 3 + 5 (first time bonus)
    expect(member?.plantTotalPoints).toBe(0);
    expect(member?.coralTotalPoints).toBe(0);
  });

  test("calculates plant program points with bonuses correctly", async () => {
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
      getDb(),
      "Java Fern",
      "Microsorum pteropus",
      "Microsorum",
      "pteropus",
      "Stem"
    );
    await approveSubmission(adminId, submissionId, plantSpeciesNameId, {
      id: submissionId,
      points: 8,
      article_points: 2,
      first_time_species: true,
      flowered: true,
      sexual_reproduction: true,
      canonical_genus: "Microsorum",
      canonical_species_name: "pteropus",
    });

    const roster = await getRosterWithPoints();
    const member = roster.find((m) => m.id === memberId);

    // 8 (base) + 2 (article) + 5 (first time) + 8 (flowered bonus) + 8 (sexual repro bonus) = 31
    expect(member?.plantTotalPoints).toBe(31);
    expect(member?.fishTotalPoints).toBe(0);
    expect(member?.coralTotalPoints).toBe(0);
  });

  test("calculates coral program points correctly", async () => {
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
      getDb(),
      "Acropora",
      "Acropora millepora",
      "Acropora",
      "millepora",
      "SPS"
    );
    await approveSubmission(adminId, submissionId, coralSpeciesNameId, {
      id: submissionId,
      points: 15,
      article_points: 5,
      first_time_species: true,
      flowered: false, // Not applicable for coral
      sexual_reproduction: false, // Not applicable for coral
      canonical_genus: "Acropora",
      canonical_species_name: "millepora",
    });

    const roster = await getRosterWithPoints();
    const member = roster.find((m) => m.id === memberId);

    expect(member?.coralTotalPoints).toBe(25); // 15 + 5 + 5 (first time bonus)
    expect(member?.fishTotalPoints).toBe(0);
    expect(member?.plantTotalPoints).toBe(0);
  });

  test("handles multiple submissions across different programs", async () => {
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
      getDb(),
      "Neon Tetra",
      "Paracheirodon innesi",
      "Paracheirodon",
      "innesi",
      "Freshwater"
    );
    await approveSubmission(adminId, fishSubmissionId, fishSpeciesNameId, {
      id: fishSubmissionId,
      points: 5,
      article_points: 0,
      first_time_species: false,
      flowered: false,
      sexual_reproduction: false,
      canonical_genus: "Paracheirodon",
      canonical_species_name: "innesi",
    });

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
      getDb(),
      "Amazon Sword",
      "Echinodorus grisebachii",
      "Echinodorus",
      "grisebachii",
      "Rosette"
    );
    await approveSubmission(adminId, plantSubmissionId, plantSpeciesNameId2, {
      id: plantSubmissionId,
      points: 6,
      article_points: 1,
      first_time_species: true,
      flowered: false,
      sexual_reproduction: true,
      canonical_genus: "Echinodorus",
      canonical_species_name: "grisebachii",
    });

    const roster = await getRosterWithPoints();
    const member = roster.find((m) => m.id === memberId);

    expect(member?.fishTotalPoints).toBe(5); // 5 + 0 + 0
    expect(member?.plantTotalPoints).toBe(18); // 6 + 1 + 5 + 0 + 6 (sexual repro bonus)
    expect(member?.coralTotalPoints).toBe(0);
  });

  test("only includes approved submissions", async () => {
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
      getDb(),
      "Molly",
      "Poecilia sphenops",
      "Poecilia",
      "sphenops",
      "Freshwater"
    );
    await approveSubmission(adminId, approvedSubmissionId, mollySpeciesNameId, {
      id: approvedSubmissionId,
      points: 7,
      article_points: 0,
      first_time_species: false,
      flowered: false,
      sexual_reproduction: false,
      canonical_genus: "Poecilia",
      canonical_species_name: "sphenops",
    });

    const roster = await getRosterWithPoints();
    const member = roster.find((m) => m.id === memberId);

    expect(member?.fishTotalPoints).toBe(7); // Only approved submission counted
  });

  test("handles invertebrates as fish program", async () => {
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
      getDb(),
      "Cherry Shrimp",
      "Neocaridina davidi",
      "Neocaridina",
      "davidi",
      "Freshwater"
    );
    await approveSubmission(adminId, submissionId, shrimpSpeciesNameId, {
      id: submissionId,
      points: 4,
      article_points: 1,
      first_time_species: true,
      flowered: false,
      sexual_reproduction: false,
      canonical_genus: "Neocaridina",
      canonical_species_name: "davidi",
    });

    const roster = await getRosterWithPoints();
    const member = roster.find((m) => m.id === memberId);

    expect(member?.fishTotalPoints).toBe(10); // 4 + 1 + 5 (Invert counts as fish program)
    expect(member?.plantTotalPoints).toBe(0);
    expect(member?.coralTotalPoints).toBe(0);
  });
});
