import { describe, test } from "node:test";
import assert from "node:assert";
import {
  checkSpecialtyAwards,
  checkMetaAwards,
  getCountableSpecialtyAwards,
  SubmissionForAward,
} from "../specialtyAwards";

void describe("Specialty Awards", () => {
  void test("Anabantoids Specialist award works correctly", () => {
    const submissions: SubmissionForAward[] = [
      {
        species_class: "Anabantoids",
        species_latin_name: "Betta splendens",
        species_type: "Fish",
        water_type: "Fresh",
      },
      {
        species_class: "Anabantoids",
        species_latin_name: "Betta imbellis",
        species_type: "Fish",
        water_type: "Fresh",
      },
      {
        species_class: "Anabantoids",
        species_latin_name: "Colisa lalia",
        species_type: "Fish",
        water_type: "Fresh",
      },
      {
        species_class: "Anabantoids",
        species_latin_name: "Trichogaster trichopterus",
        species_type: "Fish",
        water_type: "Fresh",
      },
      {
        species_class: "Anabantoids",
        species_latin_name: "Macropodus opercularis",
        species_type: "Fish",
        water_type: "Fresh",
      },
      {
        species_class: "Anabantoids",
        species_latin_name: "Trichopsis vittata",
        species_type: "Fish",
        water_type: "Fresh",
      },
    ];

    const awards = checkSpecialtyAwards(submissions);
    assert.ok(awards.includes("Anabantoids Specialist"));
  });

  void test("Marine Invertebrates & Corals Specialist works across programs", () => {
    const submissions: SubmissionForAward[] = [
      // Marine inverts from fish program
      {
        species_class: "Shrimp",
        species_latin_name: "Lysmata amboinensis",
        species_type: "Invert",
        water_type: "Salt",
      },
      {
        species_class: "Shrimp",
        species_latin_name: "Lysmata wurdemanni",
        species_type: "Invert",
        water_type: "Salt",
      },
      {
        species_class: "Other",
        species_latin_name: "Stenopus hispidus",
        species_type: "Invert",
        water_type: "Salt",
      },
      // Corals from coral program
      {
        species_class: "Hard",
        species_latin_name: "Acropora millepora",
        species_type: "Coral",
        water_type: "Salt",
      },
      {
        species_class: "Soft",
        species_latin_name: "Sinularia flexibilis",
        species_type: "Coral",
        water_type: "Salt",
      },
      {
        species_class: "Hard",
        species_latin_name: "Montipora digitata",
        species_type: "Coral",
        water_type: "Salt",
      },
      {
        species_class: "Soft",
        species_latin_name: "Zoanthus sociatus",
        species_type: "Coral",
        water_type: "Salt",
      },
    ];

    const awards = checkSpecialtyAwards(submissions);
    assert.ok(awards.includes("Marine Invertebrates & Corals Specialist"));
  });

  void test("Brackish Water Specialist works across species types", () => {
    const submissions: SubmissionForAward[] = [
      {
        species_class: "Livebearers",
        species_latin_name: "Poecilia latipinna",
        species_type: "Fish",
        water_type: "Brackish",
      },
      {
        species_class: "Other",
        species_latin_name: "Neritina natalensis",
        species_type: "Invert",
        water_type: "Brackish",
      },
      {
        species_class: "Killifish",
        species_latin_name: "Fundulus heteroclitus",
        species_type: "Fish",
        water_type: "Brackish",
      },
    ];

    const awards = checkSpecialtyAwards(submissions);
    assert.ok(awards.includes("Brackish Water Specialist"));
  });

  void test("Catfish Specialist limitation works correctly", () => {
    // Test with all Corydoras - should not qualify due to limitation
    const allCorydoras: SubmissionForAward[] = [
      {
        species_class: "Catfish & Loaches",
        species_latin_name: "Corydoras paleatus",
        species_type: "Fish",
        water_type: "Fresh",
        canonical_genus: "Corydoras",
      },
      {
        species_class: "Catfish & Loaches",
        species_latin_name: "Corydoras aeneus",
        species_type: "Fish",
        water_type: "Fresh",
        canonical_genus: "Corydoras",
      },
      {
        species_class: "Catfish & Loaches",
        species_latin_name: "Corydoras julii",
        species_type: "Fish",
        water_type: "Fresh",
        canonical_genus: "Corydoras",
      },
      {
        species_class: "Catfish & Loaches",
        species_latin_name: "Corydoras panda",
        species_type: "Fish",
        water_type: "Fresh",
        canonical_genus: "Corydoras",
      },
      {
        species_class: "Catfish & Loaches",
        species_latin_name: "Corydoras sterbai",
        species_type: "Fish",
        water_type: "Fresh",
        canonical_genus: "Corydoras",
      },
    ];

    let awards = checkSpecialtyAwards(allCorydoras);
    assert.ok(!awards.includes("Catfish Specialist"));

    // Test with mix including non-Corydoras - should qualify
    const mixedCatfish: SubmissionForAward[] = [
      ...allCorydoras,
      {
        species_class: "Catfish & Loaches",
        species_latin_name: "Ancistrus sp.",
        species_type: "Fish",
        water_type: "Fresh",
        canonical_genus: "Ancistrus",
      },
    ];

    awards = checkSpecialtyAwards(mixedCatfish);
    assert.ok(awards.includes("Catfish Specialist"));
  });

  void test("Awards require sufficient unique species", () => {
    // Only 2 Anabantoids species - should not qualify (needs 6)
    const submissions: SubmissionForAward[] = [
      {
        species_class: "Anabantoids",
        species_latin_name: "Betta splendens",
        species_type: "Fish",
        water_type: "Fresh",
      },
      {
        species_class: "Anabantoids",
        species_latin_name: "Betta imbellis",
        species_type: "Fish",
        water_type: "Fresh",
      },
    ];

    const awards = checkSpecialtyAwards(submissions);
    assert.ok(!awards.includes("Anabantoids Specialist"));
  });

  void test("Duplicate species are counted only once", () => {
    // 6 submissions but only 3 unique species - should not qualify
    const submissions: SubmissionForAward[] = [
      {
        species_class: "Anabantoids",
        species_latin_name: "Betta splendens",
        species_type: "Fish",
        water_type: "Fresh",
      },
      {
        species_class: "Anabantoids",
        species_latin_name: "Betta splendens", // duplicate
        species_type: "Fish",
        water_type: "Fresh",
      },
      {
        species_class: "Anabantoids",
        species_latin_name: "Betta imbellis",
        species_type: "Fish",
        water_type: "Fresh",
      },
      {
        species_class: "Anabantoids",
        species_latin_name: "Betta imbellis", // duplicate
        species_type: "Fish",
        water_type: "Fresh",
      },
      {
        species_class: "Anabantoids",
        species_latin_name: "Colisa lalia",
        species_type: "Fish",
        water_type: "Fresh",
      },
      {
        species_class: "Anabantoids",
        species_latin_name: "Colisa lalia", // duplicate
        species_type: "Fish",
        water_type: "Fresh",
      },
    ];

    const awards = checkSpecialtyAwards(submissions);
    assert.ok(!awards.includes("Anabantoids Specialist"));
  });

  void test("Catfish award handles missing genus data gracefully", () => {
    // Test with submissions missing genus data - should fail limitation gracefully
    const catfishWithoutGenus: SubmissionForAward[] = [
      {
        species_class: "Catfish & Loaches",
        species_latin_name: "Corydoras paleatus",
        species_type: "Fish",
        water_type: "Fresh",
        // No canonical_genus field
      },
      {
        species_class: "Catfish & Loaches",
        species_latin_name: "Corydoras aeneus",
        species_type: "Fish",
        water_type: "Fresh",
        // No canonical_genus field
      },
      {
        species_class: "Catfish & Loaches",
        species_latin_name: "Ancistrus sp.",
        species_type: "Fish",
        water_type: "Fresh",
        // No canonical_genus field
      },
      {
        species_class: "Catfish & Loaches",
        species_latin_name: "Pleco sp.",
        species_type: "Fish",
        water_type: "Fresh",
        // No canonical_genus field
      },
      {
        species_class: "Catfish & Loaches",
        species_latin_name: "Synodontis sp.",
        species_type: "Fish",
        water_type: "Fresh",
        // No canonical_genus field
      },
    ];

    // Should not award because genus data is missing for limitation check
    const awards = checkSpecialtyAwards(catfishWithoutGenus);
    assert.ok(!awards.includes("Catfish Specialist"));
  });
});

void describe("Meta-Awards", () => {
  void test("getCountableSpecialtyAwards excludes invertebrates award", () => {
    const countableAwards = getCountableSpecialtyAwards();

    assert.ok(!countableAwards.includes("Marine Invertebrates & Corals Specialist"));
    assert.ok(countableAwards.includes("Anabantoids Specialist"));
    assert.ok(countableAwards.includes("Catfish Specialist"));
    assert.ok(countableAwards.includes("Killifish Specialist"));
    assert.strictEqual(countableAwards.length, 10); // 11 total - 1 excluded
  });

  void test("Senior Specialist Award requires 4 countable awards", () => {
    // 3 awards - should not qualify
    const threeAwards = ["Anabantoids Specialist", "Catfish Specialist", "Characins Specialist"];
    let metaAwards = checkMetaAwards(threeAwards);
    assert.ok(!metaAwards.includes("Senior Specialist Award"));

    // 4 awards - should qualify
    const fourAwards = [
      "Anabantoids Specialist",
      "Catfish Specialist",
      "Characins Specialist",
      "Cyprinids Specialist",
    ];
    metaAwards = checkMetaAwards(fourAwards);
    assert.ok(metaAwards.includes("Senior Specialist Award"));
  });

  void test("Expert Specialist Award requires 7 countable awards", () => {
    // 6 awards - should not qualify for Expert (but should for Senior)
    const sixAwards = [
      "Anabantoids Specialist",
      "Catfish Specialist",
      "Characins Specialist",
      "Cyprinids Specialist",
      "Killifish Specialist",
      "Livebearers Specialist",
    ];
    let metaAwards = checkMetaAwards(sixAwards);
    assert.ok(metaAwards.includes("Senior Specialist Award"));
    assert.ok(!metaAwards.includes("Expert Specialist Award"));

    // 7 awards - should qualify for Expert
    const sevenAwards = [...sixAwards, "Brackish Water Specialist"];
    metaAwards = checkMetaAwards(sevenAwards);
    assert.ok(metaAwards.includes("Expert Specialist Award"));
  });

  void test("Invertebrates award does not count toward meta-awards", () => {
    // 4 awards including invertebrates - should not qualify because invertebrates excluded
    const fourAwardsWithInverts = [
      "Anabantoids Specialist",
      "Catfish Specialist",
      "Characins Specialist",
      "Marine Invertebrates & Corals Specialist", // This one doesn't count
    ];
    let metaAwards = checkMetaAwards(fourAwardsWithInverts);
    assert.ok(!metaAwards.includes("Senior Specialist Award"));

    // 5 awards including invertebrates - should qualify (4 countable + 1 excluded)
    const fiveAwardsWithInverts = [...fourAwardsWithInverts, "Cyprinids Specialist"];
    metaAwards = checkMetaAwards(fiveAwardsWithInverts);
    assert.ok(metaAwards.includes("Senior Specialist Award"));
  });

  void test("Meta-awards are not granted if already earned", () => {
    const awardsWithExistingMeta = [
      "Anabantoids Specialist",
      "Catfish Specialist",
      "Characins Specialist",
      "Cyprinids Specialist",
      "Senior Specialist Award", // Already has this
    ];

    const metaAwards = checkMetaAwards(awardsWithExistingMeta);
    assert.ok(!metaAwards.includes("Senior Specialist Award"));
  });

  void test("Can earn both Senior and Expert in same check", () => {
    // Member with 7+ awards but no existing meta-awards
    const sevenAwards = [
      "Anabantoids Specialist",
      "Catfish Specialist",
      "Characins Specialist",
      "Cyprinids Specialist",
      "Killifish Specialist",
      "Livebearers Specialist",
      "Brackish Water Specialist",
    ];

    const metaAwards = checkMetaAwards(sevenAwards);
    assert.ok(metaAwards.includes("Senior Specialist Award"));
    assert.ok(metaAwards.includes("Expert Specialist Award"));
    assert.strictEqual(metaAwards.length, 2);
  });

  void test("Expert requires Senior threshold but can be earned independently", () => {
    // 7 awards should earn Expert (and Senior if not already earned)
    const expertLevelAwards = [
      "Anabantoids Specialist",
      "Catfish Specialist",
      "Characins Specialist",
      "Cyprinids Specialist",
      "Killifish Specialist",
      "Livebearers Specialist",
      "Brackish Water Specialist",
    ];

    const metaAwards = checkMetaAwards(expertLevelAwards);
    assert.ok(metaAwards.includes("Expert Specialist Award"));
    assert.ok(metaAwards.includes("Senior Specialist Award"));
  });
});
