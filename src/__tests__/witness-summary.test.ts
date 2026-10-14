import { describe, test } from "node:test";
import assert from "node:assert";
import { prepareWitnessPanel, type WitnessPanelInput } from "../forms/witnessPanel";
import { committeeSpeciesChoice, speciesChosenByCommittee, speciesRecordedByWitness } from "../db/submission_notes";

/** Form behavior is tested through its prepared controls and summary together. */
void describe("Witness form preparation", () => {
  const input: WitnessPanelInput = {
    submission: { program: "fish", article_link: "https://example.com/article" },
    speciesFacts: { program: "fish", pointClass: 10, isCaresSpecies: true },
    newSpecies: null,
    speciesChosenByWitness: true,
  };

  void test("readiness follows choosing a Species, settling it, then choosing base points", () => {
    assert.strictEqual(prepareWitnessPanel({ ...input, speciesFacts: null }).summary.hint, "Choose the species first");
    const unsettled = prepareWitnessPanel({ ...input, speciesChosenByWitness: false });
    assert.strictEqual(unsettled.pointsForm.settled, false);
    assert.strictEqual(unsettled.summary.hint, "Is the species right? Answer above first");
    const unvalued = prepareWitnessPanel({ ...input, speciesFacts: { ...input.speciesFacts!, pointClass: null } });
    assert.strictEqual(unvalued.pointsForm.values.points, null);
    assert.strictEqual(unvalued.summary.hint, "Choose the base points");
  });

  void test("Witness defaults and summary agree, without awarding first-time", () => {
    const panel = prepareWitnessPanel(input);
    assert.deepStrictEqual(panel.pointsForm.values, {
      points: 10, article_points: 5, cares_species: true, flowered: false, sexual_reproduction: false, first_time_species: false,
    });
    assert.strictEqual(panel.pointsForm.offered.first_time_species, false);
    assert.strictEqual(panel.summary.ready, true);
    assert.deepStrictEqual(panel.summary.lines, [
      { label: "Base points", amount: 10 }, { label: "Article Bonus", amount: 5 }, { label: "CARES Species Bonus", amount: 5 },
    ]);
    assert.strictEqual(panel.summary.total, 20);
  });

  for (const program of ["fish", "plant", "coral"]) {
    void test(`a correction entering ${program} starts every bonus afresh`, () => {
      const panel = prepareWitnessPanel({
        ...input,
        submission: { program: program === "plant" ? "fish" : "plant", article_link: "https://example.com/article" },
        speciesFacts: { program, pointClass: 15, isCaresSpecies: true },
        correction: {
          approved: true, speciesChanged: true,
          current: { points: 10, article_points: 10, cares_species: true, flowered: true, sexual_reproduction: true, first_time_species: true },
        },
      });
      assert.strictEqual(panel.pointsForm.bonusesReset, true);
      assert.deepStrictEqual(panel.pointsForm.values, {
        points: 15, article_points: null, cares_species: false, flowered: false, sexual_reproduction: false, first_time_species: false,
      });
      assert.deepStrictEqual(panel.summary.lines, [{ label: "Base points", amount: 15 }]);
      assert.strictEqual(panel.summary.total, 15);
      assert.strictEqual(panel.summaryButton?.label, "Save correction");
    });
  }

  void test("same-Program corrections preserve bonuses while base points and CARES follow the selected Species", () => {
    const panel = prepareWitnessPanel({
      ...input,
      speciesFacts: { program: "fish", pointClass: 15, isCaresSpecies: false },
      correction: {
        approved: true, speciesChanged: true,
        current: { points: 10, article_points: 10, cares_species: true, flowered: false, sexual_reproduction: false, first_time_species: true },
      },
    });
    assert.strictEqual(panel.pointsForm.bonusesReset, false);
    assert.deepStrictEqual(panel.pointsForm.values, {
      points: 15, article_points: 10, cares_species: false, flowered: false, sexual_reproduction: false, first_time_species: true,
    });
    assert.strictEqual(panel.summary.total, 30);
  });

  void test("a recorded Species supplies the same defaults as a catalogue Species", () => {
    const panel = prepareWitnessPanel({ ...input, speciesFacts: null, newSpecies: { program: "plant", pointClass: 15, isCaresSpecies: false } });
    assert.strictEqual(panel.pointsForm.settled, true);
    assert.strictEqual(panel.pointsForm.program, "plant");
    assert.strictEqual(panel.pointsForm.offered.flowered, true);
    assert.strictEqual(panel.pointsForm.offered.cares_species, false);
    assert.strictEqual(panel.summary.total, 20);
  });
});

void describe("Whether the committee chose the Species", () => {
  const note = (text: unknown) => ({ note_text: typeof text === "string" ? text : JSON.stringify(text) });

  void test("a changelog entry that changed the species says yes", () => {
    const notes = [
      note("Looks healthy"),
      note({ type: "admin_edit", changes: [{ field: "species", old: null, new: "Poecilia wingei" }], reason: "Settled at the Witness" }),
    ];
    assert.strictEqual(speciesChosenByCommittee(notes), true);
  });

  void test("plain notes, other edits, and malformed notes say no", () => {
    assert.strictEqual(speciesChosenByCommittee([]), false);
    assert.strictEqual(speciesChosenByCommittee([note("Looks healthy")]), false);
    assert.strictEqual(speciesChosenByCommittee([note("{not json")]), false);
    assert.strictEqual(
      speciesChosenByCommittee([note({ type: "admin_edit", changes: [{ field: "species_class", old: "a", new: "b" }] })]),
      false
    );
    assert.strictEqual(speciesChosenByCommittee([note({ type: "other", changes: [{ field: "species" }] })]), false);
  });

  void test("a member's save after the choice takes it back; a choice after the save stands", () => {
    const chose = note({ type: "admin_edit", changes: [{ field: "species", old: null, new: "Poecilia wingei" }], reason: "Bound to a Species" });
    const saved = note({ type: "member_save", voided: "choice", member_id: 7, timestamp: "2026-10-11T12:00:00.000Z" });

    assert.strictEqual(speciesChosenByCommittee([chose, saved]), false, "ADR-0001: the save voids the Witness, and the question with it");
    assert.strictEqual(speciesChosenByCommittee([saved, chose]), true);
    assert.strictEqual(speciesChosenByCommittee([chose, saved, chose]), true);
    assert.strictEqual(speciesChosenByCommittee([saved]), false);
    assert.strictEqual(
      speciesChosenByCommittee([chose, saved, note({ type: "admin_edit", changes: [{ field: "points", old: 10, new: 15 }], reason: "Corrected" })]),
      false,
      "a later edit that did not touch the Species does not count as a choice"
    );
  });

  void test("the choice that stands is the entry itself, so the panel can say who made it", () => {
    const don = { admin_id: 3, admin_name: "Don Lang", ...note({ type: "admin_edit", changes: [{ field: "species", old: null, new: "Poecilia wingei" }], reason: "Bound" }) };
    const jane = { admin_id: 4, admin_name: "Jane Ortiz", ...note({ type: "admin_edit", changes: [{ field: "species", old: "Poecilia wingei", new: "Poecilia reticulata" }], reason: "Settled" }) };
    const saved = { admin_id: null, admin_name: null, ...note({ type: "member_save", voided: "choice", member_id: 7, timestamp: "2026-10-11T12:00:00.000Z" }) };

    assert.strictEqual(committeeSpeciesChoice([don]), don);
    assert.strictEqual(committeeSpeciesChoice([don, jane]), jane, "the last choice");
    assert.strictEqual(committeeSpeciesChoice([don, saved]), null);
    assert.strictEqual(committeeSpeciesChoice([don, saved, jane]), jane);
    assert.strictEqual(committeeSpeciesChoice([]), null);
  });
});

/**
 * Whether the witness recorded the Species (#522): the "Settled at the
 * Witness" entry carries a `new_species` change, which the approval queue
 * reads as "New species recorded by the witness".
 */
void describe("Whether the witness recorded the Species", () => {
  const note = (text: unknown) => ({ note_text: typeof text === "string" ? text : JSON.stringify(text) });
  const settled = (changes: { field: string }[]) =>
    note({ type: "admin_edit", changes, reason: "Settled at the Witness" });

  void test("a changelog entry with a new_species change says yes", () => {
    const notes = [settled([{ field: "new_species" }, { field: "species" }])];
    assert.strictEqual(speciesRecordedByWitness(notes), true);
    assert.strictEqual(speciesChosenByCommittee(notes), true, "a recorded Species is also one the committee chose");
  });

  void test("a rebind to an existing Species, plain notes and malformed notes say no", () => {
    assert.strictEqual(speciesRecordedByWitness([]), false);
    assert.strictEqual(speciesRecordedByWitness([settled([{ field: "species" }])]), false);
    assert.strictEqual(speciesRecordedByWitness([note("Looks healthy"), note("{not json")]), false);
  });
});
