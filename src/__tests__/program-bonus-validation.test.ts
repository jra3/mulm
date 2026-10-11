import { describe, test } from "node:test";
import assert from "node:assert";
import path from "path";
import pug from "pug";
import { approvalSchema } from "../forms/approval";
import { approvedEditSchema } from "../forms/approvedEdit";
import { confirmWitnessSchema, recordSpeciesForm } from "../forms/confirmWitness";
import { bonusFields, programBonuses } from "../points";
import type { ProgramType } from "../programs";

/**
 * Per-program bonus enforcement at the points-setting schemas.
 *
 * Which bonuses a program may carry is data in src/points.ts, and the witness,
 * approval and approved-edit schemas are factories that take the submission's
 * program and refuse a bonus that does not apply to it. These tests parse bodies
 * through those factories: no database, no routes.
 *
 * Every body below carries the fields the base object requires, because an
 * object-level refinement does not run when the base parse fails - a body
 * missing `group_id` would report only that and never reach the bonus rule.
 */

const allPrograms: ProgramType[] = ["fish", "plant", "coral"];

type BonusCase = {
  name: string;
  program: ProgramType;
  /** Bonus fields as a form posts them. */
  bonuses: Record<string, string>;
  /** The field paths that must carry an issue; empty means the body passes. */
  rejected: string[];
};

const cases: BonusCase[] = [
  {
    name: "flowered on a fish submission",
    program: "fish",
    bonuses: { flowered: "1" },
    rejected: ["flowered"],
  },
  {
    name: "sexual reproduction on a fish submission",
    program: "fish",
    bonuses: { sexual_reproduction: "1" },
    rejected: ["sexual_reproduction"],
  },
  {
    name: "both plant bonuses on a fish submission",
    program: "fish",
    bonuses: { flowered: "1", sexual_reproduction: "1" },
    rejected: ["flowered", "sexual_reproduction"],
  },
  {
    name: "flowered on a coral submission",
    program: "coral",
    bonuses: { flowered: "1" },
    rejected: ["flowered"],
  },
  {
    name: "CARES on a plant submission",
    program: "plant",
    bonuses: { cares_species: "1" },
    rejected: ["cares_species"],
  },
  {
    name: "CARES on a coral submission",
    program: "coral",
    bonuses: { cares_species: "1" },
    rejected: ["cares_species"],
  },
  {
    name: "flowered and sexual reproduction on a plant submission",
    program: "plant",
    bonuses: { flowered: "1", sexual_reproduction: "1" },
    rejected: [],
  },
  {
    name: "CARES on a fish submission",
    program: "fish",
    bonuses: { cares_species: "1" },
    rejected: [],
  },
  // First-time species and the article bonus apply to all three programs.
  ...allPrograms.map((program) => ({
    name: `first-time species and article on a ${program} submission`,
    program,
    bonuses: { first_time_species: "1", article_points: "5" },
    rejected: [],
  })),
  ...allPrograms.map((program) => ({
    name: `no bonuses at all on a ${program} submission`,
    program,
    bonuses: {},
    rejected: [],
  })),
];

const forms = [
  {
    name: "witness",
    parse: (program: string, bonuses: Record<string, string>) =>
      confirmWitnessSchema(program).safeParse({
        species_id: "42",
        points: "10",
        // The witness panel's switches post "on"; the approval form's post "1"
        ...Object.fromEntries(
          Object.entries(bonuses).map(([field, value]) => [field, field === "article_points" ? value : "on"])
        ),
      }),
  },
  {
    name: "approval",
    parse: (program: string, bonuses: Record<string, string>) =>
      approvalSchema(program).safeParse({ group_id: "42", points: "10", ...bonuses }),
  },
  {
    name: "approved edit",
    parse: (program: string, bonuses: Record<string, string>) =>
      approvedEditSchema(program).safeParse({
        points: "10",
        reason: "Correcting the bonuses on this record",
        ...bonuses,
      }),
  },
];

for (const form of forms) {
  void describe(`Per-program bonuses - ${form.name} schema`, () => {
    for (const { name, program, bonuses, rejected } of cases) {
      const outcome = rejected.length === 0 ? "passes" : `is rejected on ${rejected.join(", ")}`;

      void test(`${name} ${outcome}`, () => {
        const result = form.parse(program, bonuses);
        const issues = result.success ? [] : result.error.issues;

        assert.deepStrictEqual(
          issues.map((issue) => String(issue.path[0])).sort(),
          [...rejected].sort(),
          `${name}: ${issues.map((issue) => issue.message).join("; ")}`
        );

        // Each issue must name the bonus it is about, since a bonus the program
        // cannot carry has no checkbox on the panel to sit beside.
        for (const issue of issues) {
          assert.match(issue.message, /bonus does not apply to/);
        }
      });
    }
  });
}

/**
 * The witness panel's form: the Species, the base points as one of the Point
 * classes, the article bonus as None, 5 or 10, and no first-time field at all,
 * since approval computes it (ADR-0003).
 */
void describe("The confirm-witness schema", () => {
  const parse = (body: Record<string, string>) =>
    confirmWitnessSchema("fish").safeParse({ species_id: "7", points: "10", ...body });
  const issuesOf = (body: Record<string, string>) => {
    const result = parse(body);
    return result.success ? [] : result.error.issues.map((issue) => [String(issue.path[0]), issue.message]);
  };

  void test("a complete body parses to the transition's shape", () => {
    const result = parse({ article_points: "5", cares_species: "on", add_common_name: "on" });
    assert.ok(result.success);
    assert.deepStrictEqual(result.data, {
      species_id: 7,
      new_species: undefined,
      points: 10,
      article_points: 5,
      cares_species: true,
      flowered: false,
      sexual_reproduction: false,
      add_common_name: true,
      add_scientific_name: false,
    });
  });

  void test("the Species and the base points are required", () => {
    const noSpecies = confirmWitnessSchema("fish").safeParse({ points: "10" });
    assert.ok(!noSpecies.success);
    assert.deepStrictEqual(noSpecies.error.issues.map((issue) => String(issue.path[0])), ["species_id"]);

    const noPoints = confirmWitnessSchema("fish").safeParse({ species_id: "7" });
    assert.ok(!noPoints.success);
    assert.deepStrictEqual(noPoints.error.issues.map((issue) => String(issue.path[0])), ["points"]);
  });

  void test("base points must be a Point class: 5, 10, 15 or 20", () => {
    for (const points of ["5", "10", "15", "20"]) {
      assert.ok(parse({ points }).success, points);
    }
    assert.deepStrictEqual(issuesOf({ points: "12" }), [["points", "Base points must be 5, 10, 15 or 20"]]);
    assert.deepStrictEqual(issuesOf({ points: "0" }), [["points", "Base points must be 5, 10, 15 or 20"]]);
  });

  void test("the article bonus is None (null), 5 or 10", () => {
    assert.strictEqual(parse({}).data?.article_points, null);
    assert.strictEqual(parse({ article_points: "" }).data?.article_points, null);
    assert.strictEqual(parse({ article_points: "0" }).data?.article_points, null);
    assert.strictEqual(parse({ article_points: "10" }).data?.article_points, 10);
    assert.deepStrictEqual(issuesOf({ article_points: "7" }), [["article_points", "The article bonus is None, 5 or 10"]]);
  });

  void test("first-time is not the witness's to set", () => {
    const result = parse({ first_time_species: "on" });
    assert.ok(result.success);
    assert.ok(!("first_time_species" in result.data));
  });

  /**
   * The witness recorded a Species the catalogue lacks (#522): the new
   * Species rides on the confirm in place of a species_id, so the one
   * transaction creates it and confirms the Witness.
   */
  const newSpecies = {
    new_scientific_name: "Apistogramma sp. 'Rio Mamuru'",
    new_common_name: "Apisto Rio Mamuru",
    new_point_class: "15",
    new_cares_species: "on",
  };

  void test("a new Species stands in for the species_id, parsed to the transition's shape", () => {
    const result = confirmWitnessSchema("fish").safeParse({ points: "15", ...newSpecies });
    assert.ok(result.success, JSON.stringify(result.error?.issues));
    assert.strictEqual(result.data.species_id, undefined);
    assert.deepStrictEqual(result.data.new_species, {
      canonicalGenus: "Apistogramma",
      canonicalSpeciesName: "sp. 'Rio Mamuru'",
      commonName: "Apisto Rio Mamuru",
      pointClass: 15,
      isCaresSpecies: true,
    });
  });

  void test("a Species and a new Species together are refused, as is neither", () => {
    const both = confirmWitnessSchema("fish").safeParse({ species_id: "7", points: "15", ...newSpecies });
    assert.ok(!both.success);
    assert.deepStrictEqual(both.error.issues.map((issue) => String(issue.path[0])), ["species_id"]);

    const neither = confirmWitnessSchema("fish").safeParse({ points: "15" });
    assert.ok(!neither.success);
    assert.deepStrictEqual(neither.error.issues.map((issue) => [String(issue.path[0]), issue.message]), [
      ["species_id", "Choose the Species first"],
    ]);
  });

  void test("a new Species' own refusals are the confirm's refusals", () => {
    const result = confirmWitnessSchema("fish").safeParse({ points: "15", ...newSpecies, new_point_class: "12" });
    assert.ok(!result.success);
    assert.deepStrictEqual(result.error.issues.map((issue) => String(issue.path[0])), ["new_point_class"]);
  });
});

/**
 * The panel's Record new species step (#522): the scientific name as genus
 * and epithet, an optional common name, the Point class and CARES. Nothing is
 * written from it; the panel carries the values back to the confirm.
 */
void describe("The record-species form", () => {
  const parse = (body: Record<string, string>) =>
    recordSpeciesForm.safeParse({ new_scientific_name: "Ameca splendens", new_point_class: "10", ...body });
  const issuesOf = (body: Record<string, string>) => {
    const result = parse(body);
    return result.success ? [] : result.error.issues.map((issue) => [String(issue.path[0]), issue.message]);
  };

  void test("splits the scientific name into genus and epithet, trims, and reads an empty common name as none", () => {
    const result = parse({ new_scientific_name: "  Ameca   splendens ", new_common_name: "  " });
    assert.ok(result.success);
    assert.deepStrictEqual(result.data, {
      canonicalGenus: "Ameca",
      canonicalSpeciesName: "splendens",
      commonName: null,
      pointClass: 10,
      isCaresSpecies: false,
    });
    assert.strictEqual(parse({ new_common_name: " Butterfly goodeid " }).data?.commonName, "Butterfly goodeid");
    assert.strictEqual(parse({ new_cares_species: "on" }).data?.isCaresSpecies, true);
  });

  void test("the epithet may be several words, as in a sp. name", () => {
    assert.deepStrictEqual(
      [parse({ new_scientific_name: "Apistogramma sp. 'Rio Mamuru'" }).data?.canonicalGenus,
        parse({ new_scientific_name: "Apistogramma sp. 'Rio Mamuru'" }).data?.canonicalSpeciesName],
      ["Apistogramma", "sp. 'Rio Mamuru'"]
    );
  });

  void test("a scientific name needs a genus and a species", () => {
    assert.deepStrictEqual(issuesOf({ new_scientific_name: "Ameca" }), [
      ["new_scientific_name", "Give the scientific name as genus and species, like Poecilia reticulata"],
    ]);
    assert.deepStrictEqual(issuesOf({ new_scientific_name: "" }), [
      ["new_scientific_name", "Give the scientific name as genus and species, like Poecilia reticulata"],
    ]);
  });

  void test("the Point class is required and one of 5, 10, 15 or 20", () => {
    assert.deepStrictEqual(issuesOf({ new_point_class: "" }), [["new_point_class", "Choose the Point class"]]);
    assert.deepStrictEqual(issuesOf({ new_point_class: "12" }), [["new_point_class", "The Point class is 5, 10, 15 or 20"]]);
    for (const pc of ["5", "10", "15", "20"]) {
      assert.strictEqual(parse({ new_point_class: pc }).data?.pointClass, Number(pc));
    }
  });
});

void describe("Per-program bonuses - the exported set", () => {
  void test("BAP (fish) carries article, first-time species and CARES", () => {
    assert.deepStrictEqual(
      [...programBonuses.fish],
      ["article_points", "first_time_species", "cares_species"]
    );
  });

  void test("HAP (plant) carries article, first-time species, flowered and sexual reproduction", () => {
    assert.deepStrictEqual(
      [...programBonuses.plant],
      ["article_points", "first_time_species", "flowered", "sexual_reproduction"]
    );
  });

  void test("CAP (coral) carries article and first-time species only", () => {
    assert.deepStrictEqual([...programBonuses.coral], ["article_points", "first_time_species"]);
  });
});

void describe("Per-program bonuses - the approval panel shows the issue", () => {
  const viewsPath = path.join(__dirname, "../views");

  const approval = {
    speciesName: "Apistogramma cacatuoides",
    speciesType: "Fish",
    programClass: "Cichlids - New World",
    pointClass: 10,
    isFirstTime: true,
    priorBreedCount: 0,
    isCaresSpecies: false,
  };

  function render(template: string, locals: Record<string, unknown>): string {
    const compiled = pug.compileFile(path.join(viewsPath, template), { basedir: viewsPath });
    return compiled(locals);
  }

  // A rejected bonus is one the program cannot carry, so its checkbox is never
  // on the page: without these messages the approval would fail silently.
  void test("a flowered issue reaches the panel of a fish submission", () => {
    const message = "The flowered bonus does not apply to Breeders Awards Program submissions";
    const html = render("admin/approvalPanel.pug", {
      submission: { id: 1, points: 10, species_class: "Cichlids", program: "fish" },
      speciesFacts: approval,
      bonusFields,
      errors: new Map([["flowered", message]]),
    });

    assert.ok(!html.includes('name="flowered"'), "a fish submission has no flowered checkbox");
    assert.ok(html.includes(message), "the flowered message must still be on the page");
  });

  void test("a CARES issue reaches the bonus section of a plant submission", () => {
    const message =
      "The CARES species bonus does not apply to Horticultural Awards Program submissions";
    const html = render("admin/approvalPanel.pug", {
      submission: { id: 1, points: 10, species_class: "Cryptocoryne", program: "plant" },
      speciesFacts: { ...approval, speciesType: "Plant", programClass: "Cryptocoryne" },
      bonusFields,
      errors: new Map([["cares_species", message]]),
    });

    assert.ok(!html.includes('name="cares_species"'), "a plant submission has no CARES checkbox");
    assert.ok(html.includes(message), "the CARES message must still be on the page");
  });
});

void describe("Per-program bonuses - refinement ordering", () => {
  void test("a body missing a required field reports only that field", () => {
    const result = approvalSchema("fish").safeParse({ flowered: "1" });
    const issues = result.success ? [] : result.error.issues;

    assert.deepStrictEqual(
      issues.map((issue) => String(issue.path[0])),
      ["points"]
    );
  });

  void test("a program name that is not one of ours still rejects a program-specific bonus", () => {
    const result = approvalSchema("terrestrial").safeParse({
      points: "10",
      cares_species: "1",
      first_time_species: "1",
    });
    const issues = result.success ? [] : result.error.issues;

    assert.deepStrictEqual(
      issues.map((issue) => String(issue.path[0])),
      ["cares_species"]
    );
  });
});
