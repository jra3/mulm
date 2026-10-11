import { describe, test } from "node:test";
import assert from "node:assert";
import { witnessSummary } from "../routes/submission";
import { committeeSpeciesChoice, speciesChosenByCommittee, speciesRecordedByWitness } from "../db/submission_notes";
import { totalPoints } from "../points";

/**
 * The witness panel's sticky bar is summed on the server over the one Points
 * rule, and says what is still missing until it can confirm. No database.
 */
void describe("The witness panel's summary", () => {
  const filled = {
    bound: true,
    species_settled: true,
    points: 10 as number | null,
    article_points: 5 as number | null,
    cares_species: true,
    flowered: false,
    sexual_reproduction: false,
  };

  void test("not ready until the Species is chosen, then settled, then the base points chosen, in that order", () => {
    assert.deepStrictEqual(witnessSummary({ ...filled, bound: false, species_settled: false, points: null }), {
      ready: false,
      lines: [],
      total: 0,
      hint: "Choose the species first",
    });
    assert.strictEqual(witnessSummary({ ...filled, species_settled: false }).hint, "Is the species right? Answer above first");
    assert.strictEqual(witnessSummary({ ...filled, points: null }).hint, "Choose the base points");
  });

  void test("first-time counts only when the correction form says so; the Witness never passes it", () => {
    const corrected = witnessSummary({ ...filled, first_time_species: true });
    assert.deepStrictEqual(corrected.lines.map((line) => line.label), [
      "Base points",
      "Article Bonus",
      "First Time Species Bonus",
      "CARES Species Bonus",
    ]);
    assert.strictEqual(corrected.total, totalPoints({ points: 10, article_points: 5, cares_species: true, first_time_species: true }));
    assert.strictEqual(witnessSummary(filled).total, 20, "left off, it is not counted");
  });

  void test("ready: base points first, then each bonus that is set, adding up to the rule's total", () => {
    const summary = witnessSummary(filled);
    assert.strictEqual(summary.ready, true);
    assert.strictEqual(summary.hint, null);
    assert.deepStrictEqual(summary.lines, [
      { label: "Base points", amount: 10 },
      { label: "Article Bonus", amount: 5 },
      { label: "CARES Species Bonus", amount: 5 },
    ]);
    assert.strictEqual(summary.total, 20);
    assert.strictEqual(
      summary.lines.reduce((sum, line) => sum + line.amount, 0),
      totalPoints({ points: 10, article_points: 5, cares_species: true })
    );
  });

  void test("the plant bonuses each add the base points", () => {
    const summary = witnessSummary({
      ...filled,
      points: 15,
      article_points: null,
      cares_species: false,
      flowered: true,
      sexual_reproduction: true,
    });
    assert.deepStrictEqual(
      summary.lines.map((line) => [line.label, line.amount]),
      [
        ["Base points", 15],
        ["Flowering Bonus", 15],
        ["Sexual Reproduction Bonus", 15],
      ]
    );
    assert.strictEqual(summary.total, 45);
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
