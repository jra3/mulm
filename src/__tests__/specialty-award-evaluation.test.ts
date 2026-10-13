import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSpecialtyAwards,
  evaluateMetaAwards,
  specialtyAwards,
  type SubmissionForAward,
} from "@/specialtyAwards";

const fact = (name: string, changes: Partial<SubmissionForAward> = {}): SubmissionForAward => ({
  species_latin_name: name,
  species_class: "Anabantoids",
  species_type: "Fish",
  water_type: "Fresh",
  ...changes,
});

void describe("Pure Specialty Award evaluation", () => {
  void test("returns eligible evidence, case-folded spelling counts, and exact threshold qualification", () => {
    const facts = Array.from({ length: 6 }, (_, i) => fact(`Betta species${i}`));
    const duplicate = fact("BETTA SPECIES0");
    const ineligible = fact("Other fish", { species_class: "Characins" });
    const [below] = evaluateSpecialtyAwards(facts.slice(1));
    assert.equal(below.count, 5);
    assert.equal(below.qualified, false);
    const [atThreshold] = evaluateSpecialtyAwards([...facts, duplicate, ineligible]);
    assert.deepEqual(atThreshold.eligibleSubmissions, [...facts, duplicate]);
    assert.deepEqual(
      atThreshold.distinctSpecies,
      facts.map((f) => f.species_latin_name.toLowerCase())
    );
    assert.equal(atThreshold.count, 6);
    assert.equal(atThreshold.requiredCount, 6);
    assert.equal(atThreshold.limitationMet, true);
    assert.equal(atThreshold.qualified, true);
  });

  void test("evaluates limitations below and at threshold using bound Canonical genus", () => {
    const definition = specialtyAwards.find((a) => a.name === "Catfish Specialist")!;
    const facts = Array.from({ length: 5 }, (_, i) =>
      fact(`Corydoras species${i}`, {
        species_class: "Catfish & Loaches",
        canonical_genus: "CORYDORAS",
      })
    );
    for (const count of [4, 5]) {
      const [evaluation] = evaluateSpecialtyAwards(facts.slice(0, count), [definition]);
      assert.equal(evaluation.count, count);
      assert.equal(evaluation.limitationMet, false);
      assert.equal(evaluation.qualified, false);
    }
    // The member's spelling does not decide the genus limitation.
    facts[0] = { ...facts[0], canonical_genus: "Ancistrus" };
    assert.equal(evaluateSpecialtyAwards(facts, [definition])[0].qualified, true);
  });

  void test("limitations retain all eligible Submissions, including repeated spellings", () => {
    const definition = specialtyAwards.find((a) => !a.countsTowardMeta)!;
    const facts = Array.from({ length: 6 }, (_, i) =>
      fact(`Snail species${i}`, {
        species_class: "Snail",
        species_type: "Invert",
        water_type: "Salt",
      })
    );
    const shrimp = fact("Shrimp species", {
      species_class: "Shrimp",
      species_type: "Invert",
      water_type: "Salt",
    });
    const [limited] = evaluateSpecialtyAwards([...facts, shrimp], [definition]);
    assert.equal(limited.count, 7);
    assert.equal(limited.qualified, false);
    const [qualified] = evaluateSpecialtyAwards([...facts, shrimp, shrimp], [definition]);
    assert.equal(qualified.count, 7);
    assert.equal(qualified.qualified, true);
  });

  void test("meta thresholds count distinct eligible specialties and exclude marine invertebrates", () => {
    const countable = specialtyAwards.filter((a) => a.countsTowardMeta).map((a) => a.name);
    const excluded = specialtyAwards.find((a) => !a.countsTowardMeta)!.name;
    for (const [count, senior, expert] of [
      [3, false, false],
      [4, true, false],
      [6, true, false],
      [7, true, true],
    ] as const) {
      const result = evaluateMetaAwards([
        ...countable.slice(0, count),
        countable[0],
        excluded,
        "Senior Specialist Award",
        "Other Award",
      ]);
      assert.deepEqual(
        result.map((e) => e.count),
        [count, count]
      );
      assert.deepEqual(
        result.map((e) => e.requiredCount),
        [4, 7]
      );
      assert.deepEqual(
        result.map((e) => e.qualified),
        [senior, expert]
      );
    }
  });
});
