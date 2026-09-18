import { describe, test } from "node:test";
import assert from "node:assert";
import path from "path";
import pug from "pug";
import { approvalSchema } from "../forms/approval";
import { approvedEditSchema } from "../forms/approvedEdit";
import { programBonuses } from "../points";
import type { ProgramType } from "../programs";

/**
 * Per-program bonus enforcement at the approval schemas.
 *
 * Which bonuses a program may carry is data in src/points.ts, and the approval
 * and approved-edit schemas are factories that take the submission's program
 * and refuse a bonus that does not apply to it. These tests parse bodies
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
    name: "approval",
    parse: (program: string, bonuses: Record<string, string>) =>
      approvalSchema(program).safeParse({ id: "1", group_id: "42", points: "10", ...bonuses }),
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
      errors: new Map([["flowered", message]]),
    });

    assert.ok(!html.includes('name="flowered"'), "a fish submission has no flowered checkbox");
    assert.ok(html.includes(message), "the flowered message must still be on the page");
  });

  void test("a CARES issue reaches the swapped bonus section of a plant submission", () => {
    const message =
      "The CARES species bonus does not apply to Horticultural Awards Program submissions";
    const html = render("admin/approvalBonuses.pug", {
      program: "plant",
      basePoints: 10,
      isFirstTime: true,
      isCaresSpecies: false,
      priorBreedCount: 0,
      errors: new Map([["cares_species", message]]),
    });

    assert.ok(!html.includes('name="cares_species"'), "a plant submission has no CARES checkbox");
    assert.ok(html.includes(message), "the CARES message must still be on the page");
  });
});

void describe("Per-program bonuses - refinement ordering", () => {
  void test("a body missing a required field reports only that field", () => {
    const result = approvalSchema("fish").safeParse({ id: "1", points: "10", flowered: "1" });
    const issues = result.success ? [] : result.error.issues;

    assert.deepStrictEqual(
      issues.map((issue) => String(issue.path[0])),
      ["group_id"]
    );
  });

  void test("a program name that is not one of ours still rejects a program-specific bonus", () => {
    const result = approvalSchema("terrestrial").safeParse({
      id: "1",
      group_id: "42",
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
