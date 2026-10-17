import { describe, test } from "node:test";
import assert from "node:assert";
import type { Submission, SubmissionSupplement } from "@/db/submissions";
import { submissionReport, type ReportRow } from "@/submissionReport";

/** A Submission with every report column unset, for each test to fill in. */
function blank(fields: Partial<Submission>): Submission {
  return {
    species_common_name: "Guppy",
    species_latin_name: "Poecilia reticulata",
    species_type: "Fish",
    species_class: "Livebearers",
    water_type: "Fresh",
    reproduction_date: "2026-08-01T12:00:00.000Z",
    count: "",
    foods: "[]",
    spawn_locations: "[]",
    propagation_method: null,
    tank_size: null,
    filter_type: null,
    water_change_volume: null,
    water_change_frequency: null,
    temperature: null,
    ph: null,
    gh: null,
    specific_gravity: null,
    substrate_type: null,
    substrate_depth: null,
    substrate_color: null,
    light_type: null,
    light_strength: null,
    light_hours: null,
    co2: null,
    co2_description: null,
    ...fields,
  } as Submission;
}

function supplement(type: string, regimen: string, order = 0): SubmissionSupplement {
  return { id: order + 1, submission_id: 1, supplement_type: type, supplement_regimen: regimen, display_order: order };
}

const byId = (rows: ReportRow[]) => new Map(rows.map((row) => [row.id, row]));

void describe("A Submission's report, labelled for its Program (#559)", () => {
  void test("BAP: spawn date, fry, foods and spawn locations; no propagation, lighting or supplements", () => {
    const report = submissionReport(
      blank({ count: "40", foods: '["Live","Flake"]', spawn_locations: '["Plant"]' }),
      []
    );
    const species = byId(report.species);

    assert.strictEqual(species.get("reproduction_date")?.label, "Date Spawned");
    assert.strictEqual(species.get("reproduction_date")?.value, "08/01/2026");
    assert.strictEqual(species.get("count")?.label, "# of Fry");
    assert.strictEqual(species.get("count")?.value, "40");
    assert.strictEqual(species.get("foods")?.value, "Live, Flake");
    assert.strictEqual(species.get("spawn_locations")?.value, "Plant");
    assert.ok(!species.has("propagation_method"));
    assert.ok(!byId(report.tank).has("light_type"));
    assert.strictEqual(report.supplements, null);
  });

  void test("HAP: propagation, lighting, CO₂ and supplements; no fry, foods or spawn locations", () => {
    const report = submissionReport(
      blank({
        species_type: "Plant",
        propagation_method: "Runners",
        light_type: "LED",
        light_strength: "40 PAR",
        light_hours: "8",
        co2: "yes",
        co2_description: "Pressurised, 1 bps",
      }),
      [supplement("Root tabs", "Monthly", 0), supplement("Liquid", "Twice weekly", 1)]
    );
    const species = byId(report.species);
    const tank = byId(report.tank);

    assert.strictEqual(species.get("reproduction_date")?.label, "Date Propagated");
    assert.strictEqual(species.get("propagation_method")?.label, "Propagation Method");
    assert.strictEqual(species.get("propagation_method")?.value, "Runners");
    assert.strictEqual(species.get("propagation_method")?.wide, true);
    assert.ok(!species.has("count"));
    assert.ok(!species.has("foods"));
    assert.ok(!species.has("spawn_locations"));
    assert.strictEqual(tank.get("light_type")?.value, "LED");
    assert.strictEqual(tank.get("light_strength")?.value, "40 PAR");
    assert.strictEqual(tank.get("light_hours")?.value, "8");

    assert.ok(report.supplements);
    assert.deepStrictEqual(
      report.supplements.co2.map((row) => [row.label, row.value]),
      [["CO₂", "Yes"], ["CO₂ Details", "Pressurised, 1 bps"]]
    );
    assert.deepStrictEqual(report.supplements.rows, [
      { type: "Root tabs", regimen: "Monthly" },
      { type: "Liquid", regimen: "Twice weekly" },
    ]);
  });

  void test("CAP: foods and propagation both apply; no fry or spawn locations", () => {
    const report = submissionReport(
      blank({ species_type: "Coral", foods: '["Reef Roids"]', propagation_method: "Fragmentation" }),
      []
    );
    const species = byId(report.species);

    assert.strictEqual(species.get("reproduction_date")?.label, "Date Propagated");
    assert.strictEqual(species.get("foods")?.value, "Reef Roids");
    assert.strictEqual(species.get("propagation_method")?.value, "Fragmentation");
    assert.ok(!species.has("count"));
    assert.ok(!species.has("spawn_locations"));
    assert.ok(report.supplements, "the Supplements section applies to CAP");
  });

  void test("an applicable field left blank reads as unset, not dropped", () => {
    const report = submissionReport(blank({ species_type: "Plant", propagation_method: "  " }), []);

    assert.strictEqual(byId(report.species).get("propagation_method")?.value, null);
    assert.strictEqual(byId(report.tank).get("light_type")?.value, null);
    assert.strictEqual(byId(report.tank).get("gh")?.value, null);
    assert.deepStrictEqual(
      report.supplements?.co2.map((row) => [row.id, row.value]),
      [["co2", null]],
      "an older report with no CO₂ answer: unset, and no details row"
    );
    assert.deepStrictEqual(report.supplements?.rows, []);
  });

  void test("a meaningful zero or No is shown as recorded", () => {
    const fish = submissionReport(blank({ count: "0" }), []);
    const plant = submissionReport(blank({ species_type: "Plant", co2: "no" }), []);

    assert.strictEqual(byId(fish.species).get("count")?.value, "0");
    assert.deepStrictEqual(
      plant.supplements?.co2.map((row) => [row.id, row.value]),
      [["co2", "No"]],
      "No is an answer; CO₂ details are asked only after a Yes"
    );
  });

  void test("a value recorded outside its Program is kept, under that Program's label", () => {
    const fish = submissionReport(
      blank({ propagation_method: "Water change with a temperature drop", light_type: "Fluorescent", co2: "yes" }),
      []
    );
    const plant = submissionReport(blank({ species_type: "Plant", count: "BUNCH", foods: '["iron"]' }), []);

    assert.strictEqual(byId(fish.species).get("propagation_method")?.label, "Breeding Method");
    assert.strictEqual(byId(fish.tank).get("light_type")?.value, "Fluorescent");
    assert.deepStrictEqual(fish.supplements?.co2.map((row) => row.value), ["Yes"]);
    assert.strictEqual(byId(plant.species).get("count")?.label, "# of Plants");
    assert.strictEqual(byId(plant.species).get("count")?.value, "BUNCH");
    assert.strictEqual(byId(plant.species).get("foods")?.value, "iron");
  });

  void test("the old forms' CO₂ No on a fish says nothing and adds no section", () => {
    const report = submissionReport(blank({ co2: "no" }), []);

    assert.strictEqual(report.supplements, null);
  });

  void test("supplement rows: blank halves are unset, wholly blank rows are dropped", () => {
    const report = submissionReport(blank({ species_type: "Coral" }), [
      supplement("", "b ionic, amino acids", 0),
      supplement("Root tabs", "", 1),
      supplement(" ", "", 2),
    ]);

    assert.deepStrictEqual(report.supplements?.rows, [
      { type: null, regimen: "b ionic, amino acids" },
      { type: "Root tabs", regimen: null },
    ]);
  });

  void test("a list column that is not JSON is read as plain text", () => {
    const report = submissionReport(blank({ foods: "flake, live" }), []);

    assert.strictEqual(byId(report.species).get("foods")?.value, "flake, live");
  });
});
