import { describe, test } from "node:test";
import assert from "node:assert";
import { correctPointsSchema } from "../forms/correctPoints";

/**
 * The correction form's schema (#528): the witness panel's fields, a required
 * reason, and first-time on an Approved Submission only. No database.
 */
void describe("The correction form", () => {
  const body = { species_id: "7", points: "10", article_points: "5", reason: "The member disputed the point class" };
  const fields = (issues: { path: PropertyKey[] }[]) => issues.map((issue) => String(issue.path[0])).sort();

  void test("parses the Witness's fields and the reason into a correction", () => {
    const result = correctPointsSchema("fish", { approved: false }).safeParse({ ...body, cares_species: "on" });
    assert.ok(result.success, JSON.stringify(result.error?.issues));
    assert.deepStrictEqual(result.data, {
      species_id: 7,
      new_species: undefined,
      points: 10,
      article_points: 5,
      cares_species: true,
      flowered: false,
      sexual_reproduction: false,
      first_time_species: undefined,
      reason: "The member disputed the point class",
    });
  });

  void test("the reason is required, and not a couple of letters", () => {
    const missing = correctPointsSchema("fish", { approved: true }).safeParse({ species_id: "7", points: "10" });
    assert.ok(!missing.success);
    assert.deepStrictEqual(fields(missing.error.issues), ["reason"]);
    const short = correctPointsSchema("fish", { approved: true }).safeParse({ ...body, reason: "ok" });
    assert.ok(!short.success);
    assert.deepStrictEqual(fields(short.error.issues), ["reason"]);
  });

  void test("first-time is read on an Approved Submission and refused before approval", () => {
    const approved = correctPointsSchema("fish", { approved: true }).safeParse({ ...body, first_time_species: "on" });
    assert.ok(approved.success);
    assert.strictEqual(approved.data.first_time_species, true);
    const unticked = correctPointsSchema("fish", { approved: true }).safeParse(body);
    assert.ok(unticked.success);
    assert.strictEqual(unticked.data.first_time_species, false, "on an Approved Submission the switch is always an answer");

    const early = correctPointsSchema("fish", { approved: false }).safeParse({ ...body, first_time_species: "on" });
    assert.ok(!early.success);
    assert.deepStrictEqual(fields(early.error.issues), ["first_time_species"]);
    assert.match(early.error.issues[0].message, /decided at approval/);
  });

  void test("the Species is one from the catalogue or one to record, not both and not neither", () => {
    const recorded = correctPointsSchema("fish", { approved: false }).safeParse({
      points: "15",
      reason: "Not in the catalogue after all",
      new_scientific_name: "Apistogramma sp. 'Rio Mamuru'",
      new_common_name: "Apisto Rio Mamuru",
      new_point_class: "15",
    });
    assert.ok(recorded.success, JSON.stringify(recorded.error?.issues));
    assert.strictEqual(recorded.data.species_id, undefined);
    assert.deepStrictEqual(recorded.data.new_species, {
      canonicalGenus: "Apistogramma",
      canonicalSpeciesName: "sp. 'Rio Mamuru'",
      commonName: "Apisto Rio Mamuru",
      pointClass: 15,
      isCaresSpecies: false,
    });

    const both = correctPointsSchema("fish", { approved: false }).safeParse({ ...body, new_scientific_name: "Apistogramma agassizii", new_point_class: "15" });
    assert.ok(!both.success);
    assert.deepStrictEqual(fields(both.error.issues), ["species_id"]);

    const neither = correctPointsSchema("fish", { approved: false }).safeParse({ points: "10", reason: "A reason" });
    assert.ok(!neither.success);
    assert.deepStrictEqual(fields(neither.error.issues), ["species_id"]);
  });

  void test("a bonus outside the Program is refused by field, as at the Witness", () => {
    const plantOnFish = correctPointsSchema("fish", { approved: true }).safeParse({ ...body, flowered: "on" });
    assert.ok(!plantOnFish.success);
    assert.deepStrictEqual(fields(plantOnFish.error.issues), ["flowered"]);
    const caresOnPlant = correctPointsSchema("plant", { approved: true }).safeParse({ ...body, cares_species: "on" });
    assert.ok(!caresOnPlant.success);
    assert.deepStrictEqual(fields(caresOnPlant.error.issues), ["cares_species"]);
  });

  void test("the base points are a Point class and the article bonus is none, 5 or 10", () => {
    const odd = correctPointsSchema("fish", { approved: true }).safeParse({ ...body, points: "12" });
    assert.ok(!odd.success);
    assert.deepStrictEqual(fields(odd.error.issues), ["points"]);
    const article = correctPointsSchema("fish", { approved: true }).safeParse({ ...body, article_points: "7" });
    assert.ok(!article.success);
    assert.deepStrictEqual(fields(article.error.issues), ["article_points"]);
    const none = correctPointsSchema("fish", { approved: true }).safeParse({ ...body, article_points: "0" });
    assert.ok(none.success);
    assert.strictEqual(none.data.article_points, null);
  });
});
