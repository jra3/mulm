import { describe, test } from "node:test";
import assert from "node:assert";
import { speciesChosenByCommittee, witnessSummary } from "../routes/submission";
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
});
