import { createTestDatabase } from "./helpers/database";
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  anyProgramSpeciesTypeSql,
  bonusBreakdown,
  bonusesOutsideProgram,
  bonusesStillPossible,
  isArticleBonus,
  isInProgram,
  pointsBreakdown,
  programSpeciesTypeSql,
  totalPoints,
  totalPointsSql,
  type BonusLine,
  type PointsRow,
} from "../points";
import type { ProgramType } from "../programs";
import { createTestActors, type TestContext } from "./helpers/fixtures";

/**
 * The Points rule: base + article + (first-time × 5) + (CARES × 5) +
 * (flowered × base) + (sexual reproduction × base).
 *
 * Two forms of the same rule live in src/points.ts - a SQL fragment and a
 * TypeScript function - so these tests pin the arithmetic once and then prove
 * the two forms agree row for row.
 */

type PointsCase = {
  name: string;
  program: ProgramType;
  speciesType: "Fish" | "Invert" | "Plant" | "Coral";
  row: PointsRow;
  expected: number;
};

/** One row per bonus combination per program, with hand-computed totals. */
const cases: PointsCase[] = [
  // Fish (BAP), base 10
  {
    name: "fish: no bonuses",
    program: "fish",
    speciesType: "Fish",
    row: { points: 10 },
    expected: 10,
  },
  {
    name: "fish: article only",
    program: "fish",
    speciesType: "Fish",
    row: { points: 10, article_points: 3 },
    expected: 13,
  },
  {
    name: "fish: first time only",
    program: "fish",
    speciesType: "Fish",
    row: { points: 10, first_time_species: true },
    expected: 15,
  },
  {
    name: "fish: CARES only",
    program: "fish",
    speciesType: "Fish",
    row: { points: 10, cares_species: true },
    expected: 15,
  },
  {
    name: "fish: flowered only",
    program: "fish",
    speciesType: "Fish",
    row: { points: 10, flowered: true },
    expected: 20,
  },
  {
    name: "fish: sexual reproduction only",
    program: "fish",
    speciesType: "Fish",
    row: { points: 10, sexual_reproduction: true },
    expected: 20,
  },
  {
    name: "fish: every bonus",
    program: "fish",
    speciesType: "Fish",
    row: {
      points: 10,
      article_points: 3,
      first_time_species: true,
      cares_species: true,
      flowered: true,
      sexual_reproduction: true,
    },
    expected: 43,
  },
  {
    name: "invert: CARES only",
    program: "fish",
    speciesType: "Invert",
    row: { points: 10, cares_species: true },
    expected: 15,
  },

  // Plant (HAP), base 8
  {
    name: "plant: no bonuses",
    program: "plant",
    speciesType: "Plant",
    row: { points: 8 },
    expected: 8,
  },
  {
    name: "plant: article only",
    program: "plant",
    speciesType: "Plant",
    row: { points: 8, article_points: 3 },
    expected: 11,
  },
  {
    name: "plant: first time only",
    program: "plant",
    speciesType: "Plant",
    row: { points: 8, first_time_species: true },
    expected: 13,
  },
  {
    name: "plant: CARES only",
    program: "plant",
    speciesType: "Plant",
    row: { points: 8, cares_species: true },
    expected: 13,
  },
  {
    name: "plant: flowered only",
    program: "plant",
    speciesType: "Plant",
    row: { points: 8, flowered: true },
    expected: 16,
  },
  {
    name: "plant: sexual reproduction only",
    program: "plant",
    speciesType: "Plant",
    row: { points: 8, sexual_reproduction: true },
    expected: 16,
  },
  {
    name: "plant: every bonus",
    program: "plant",
    speciesType: "Plant",
    row: {
      points: 8,
      article_points: 3,
      first_time_species: true,
      cares_species: true,
      flowered: true,
      sexual_reproduction: true,
    },
    expected: 37,
  },

  // Coral (CAP), base 15
  {
    name: "coral: no bonuses",
    program: "coral",
    speciesType: "Coral",
    row: { points: 15 },
    expected: 15,
  },
  {
    name: "coral: article only",
    program: "coral",
    speciesType: "Coral",
    row: { points: 15, article_points: 3 },
    expected: 18,
  },
  {
    name: "coral: first time only",
    program: "coral",
    speciesType: "Coral",
    row: { points: 15, first_time_species: true },
    expected: 20,
  },
  {
    name: "coral: CARES only",
    program: "coral",
    speciesType: "Coral",
    row: { points: 15, cares_species: true },
    expected: 20,
  },
  {
    name: "coral: flowered only",
    program: "coral",
    speciesType: "Coral",
    row: { points: 15, flowered: true },
    expected: 30,
  },
  {
    name: "coral: sexual reproduction only",
    program: "coral",
    speciesType: "Coral",
    row: { points: 15, sexual_reproduction: true },
    expected: 30,
  },
  {
    name: "coral: every bonus",
    program: "coral",
    speciesType: "Coral",
    row: {
      points: 15,
      article_points: 3,
      first_time_species: true,
      cares_species: true,
      flowered: true,
      sexual_reproduction: true,
    },
    expected: 58,
  },

  // Flag shapes: the database stores 0/1 integers, the Submission type says boolean | null
  {
    name: "fish: null flags count as zero",
    program: "fish",
    speciesType: "Fish",
    row: {
      points: 10,
      article_points: null,
      first_time_species: null,
      cares_species: null,
      flowered: null,
      sexual_reproduction: null,
    },
    expected: 10,
  },
  {
    name: "fish: false flags count as zero",
    program: "fish",
    speciesType: "Fish",
    row: {
      points: 10,
      article_points: 0,
      first_time_species: false,
      cares_species: false,
      flowered: false,
      sexual_reproduction: false,
    },
    expected: 10,
  },
  {
    name: "fish: integer flags count the same as booleans",
    program: "fish",
    speciesType: "Fish",
    row: {
      points: 10,
      article_points: 3,
      first_time_species: 1,
      cares_species: 1,
      flowered: 1,
      sexual_reproduction: 1,
    },
    expected: 43,
  },
];

void describe("Points - TypeScript total", () => {
  for (const { name, row, expected } of cases) {
    void test(name, () => {
      assert.strictEqual(totalPoints(row), expected);
    });
  }
});

/** The base points each program's cases above use. */
const programBase: Record<ProgramType, number> = { fish: 10, plant: 8, coral: 15 };

type BreakdownCase = {
  name: string;
  row: PointsRow;
  expected: BonusLine[];
};

/** One case per bonus per program: a row carrying it, and the line it must yield. */
const breakdownCases: BreakdownCase[] = (["fish", "plant", "coral"] as ProgramType[]).flatMap(
  (program) => {
    const base = programBase[program];
    return [
      {
        name: `${program}: article`,
        row: { points: base, article_points: 3 },
        expected: [{ label: "Article Bonus", amount: 3 }],
      },
      {
        name: `${program}: first time species`,
        row: { points: base, first_time_species: true },
        expected: [{ label: "First Time Species Bonus", amount: 5 }],
      },
      {
        name: `${program}: CARES`,
        row: { points: base, cares_species: true },
        expected: [{ label: "CARES Species Bonus", amount: 5 }],
      },
      {
        name: `${program}: flowered`,
        row: { points: base, flowered: true },
        expected: [{ label: "Flowering Bonus", amount: base }],
      },
      {
        name: `${program}: sexual reproduction`,
        row: { points: base, sexual_reproduction: true },
        expected: [{ label: "Sexual Reproduction Bonus", amount: base }],
      },
    ];
  }
);

void describe("Points - bonus breakdown", () => {
  for (const { name, row, expected } of breakdownCases) {
    void test(`${name} yields one labelled line`, () => {
      assert.deepStrictEqual(bonusBreakdown(row), expected);
    });
  }

  // The acceptance criterion the approval email rests on: the itemised lines
  // plus the base points are exactly the total the email prints.
  for (const { name, row, expected } of cases) {
    void test(`${name}: lines plus base points equal the total`, () => {
      const lines = bonusBreakdown(row);
      const summed = lines.reduce((total, line) => total + line.amount, row.points ?? 0);

      assert.strictEqual(summed, totalPoints(row));
      assert.strictEqual(summed, expected);
    });
  }

  void test("a bonus that is not set yields no line", () => {
    assert.deepStrictEqual(bonusBreakdown({ points: 10 }), []);
    assert.deepStrictEqual(
      bonusBreakdown({
        points: 10,
        article_points: 0,
        first_time_species: false,
        cares_species: false,
        flowered: false,
        sexual_reproduction: false,
      }),
      []
    );
    assert.deepStrictEqual(
      bonusBreakdown({
        points: 10,
        article_points: null,
        first_time_species: null,
        cares_species: null,
        flowered: null,
        sexual_reproduction: null,
      }),
      []
    );
  });

  void test("0/1 integer flags yield the same lines as booleans", () => {
    assert.deepStrictEqual(
      bonusBreakdown({
        points: 10,
        article_points: 3,
        first_time_species: 1,
        cares_species: 1,
        flowered: 1,
        sexual_reproduction: 1,
      }),
      bonusBreakdown({
        points: 10,
        article_points: 3,
        first_time_species: true,
        cares_species: true,
        flowered: true,
        sexual_reproduction: true,
      })
    );
    assert.deepStrictEqual(bonusBreakdown({ points: 10, first_time_species: 0 }), []);
  });

  void test("every bonus at once lists all five, in formula order", () => {
    assert.deepStrictEqual(
      bonusBreakdown({
        points: 10,
        article_points: 3,
        first_time_species: true,
        cares_species: true,
        flowered: true,
        sexual_reproduction: true,
      }),
      [
        { label: "Article Bonus", amount: 3 },
        { label: "First Time Species Bonus", amount: 5 },
        { label: "CARES Species Bonus", amount: 5 },
        { label: "Flowering Bonus", amount: 10 },
        { label: "Sexual Reproduction Bonus", amount: 10 },
      ]
    );
  });
});

/**
 * The itemised sum every points display reads (#523): the witness bar, the
 * owner's pending-approval view and the witness email all print these lines,
 * so this is where "the lines add up to the total" is proved once.
 */
void describe("Points - itemised breakdown", () => {
  void test("base points first, then each bonus that is set, summing to the rule's total", () => {
    const row: PointsRow = { points: 10, article_points: 5, cares_species: 1 };
    const breakdown = pointsBreakdown(row);

    assert.deepStrictEqual(breakdown.lines, [
      { label: "Base points", amount: 10 },
      { label: "Article Bonus", amount: 5 },
      { label: "CARES Species Bonus", amount: 5 },
    ]);
    assert.strictEqual(breakdown.total, 20);
    assert.strictEqual(breakdown.total, totalPoints(row));
  });

  for (const { name, row, expected } of cases) {
    void test(`${name}: the lines add up to the total`, () => {
      const breakdown = pointsBreakdown(row);
      const summed = breakdown.lines.reduce((total, line) => total + line.amount, 0);

      assert.strictEqual(summed, breakdown.total);
      assert.strictEqual(breakdown.total, expected);
    });
  }

  void test("a row with no bonuses is the base line alone", () => {
    assert.deepStrictEqual(pointsBreakdown({ points: 15 }), {
      lines: [{ label: "Base points", amount: 15 }],
      total: 15,
    });
  });

  void test("a row the witness has not valued yet sums to nothing", () => {
    assert.deepStrictEqual(pointsBreakdown({ points: null, cares_species: 1 }), {
      lines: [{ label: "Base points", amount: 0 }, { label: "CARES Species Bonus", amount: 5 }],
      total: 5,
    });
  });
});

void describe("Points - bonuses outside a program", () => {
  void test("names each set bonus the program cannot carry, in the formula's order", () => {
    assert.deepStrictEqual(
      bonusesOutsideProgram("fish", { cares_species: true, flowered: 1, sexual_reproduction: true }),
      [
        { field: "flowered", message: "The flowered bonus does not apply to Breeders Awards Program submissions" },
        {
          field: "sexual_reproduction",
          message: "The sexual reproduction bonus does not apply to Breeders Awards Program submissions",
        },
      ]
    );
    assert.deepStrictEqual(bonusesOutsideProgram("plant", { cares_species: true }), [
      { field: "cares_species", message: "The CARES species bonus does not apply to Horticultural Awards Program submissions" },
    ]);
  });

  void test("a bonus that is unset, false or 0 raises nothing, whatever the program", () => {
    assert.deepStrictEqual(bonusesOutsideProgram("fish", { flowered: false, sexual_reproduction: 0 }), []);
    assert.deepStrictEqual(bonusesOutsideProgram("plant", { cares_species: null }), []);
    assert.deepStrictEqual(bonusesOutsideProgram("coral", {}), []);
  });

  void test("the article bonus is none, 5 or 10", () => {
    assert.strictEqual(isArticleBonus(null), true);
    assert.strictEqual(isArticleBonus(5), true);
    assert.strictEqual(isArticleBonus(10), true);
    assert.strictEqual(isArticleBonus(0), false);
    assert.strictEqual(isArticleBonus(7), false);
  });
});

void describe("Points - species type per program", () => {
  void test("BAP counts Fish and Invert", () => {
    assert.strictEqual(isInProgram("fish", "Fish"), true);
    assert.strictEqual(isInProgram("fish", "Invert"), true);
    assert.strictEqual(isInProgram("fish", "Plant"), false);
    assert.strictEqual(isInProgram("fish", "Coral"), false);
  });

  void test("HAP counts Plant", () => {
    assert.strictEqual(isInProgram("plant", "Plant"), true);
    assert.strictEqual(isInProgram("plant", "Fish"), false);
  });

  void test("CAP counts Coral", () => {
    assert.strictEqual(isInProgram("coral", "Coral"), true);
    assert.strictEqual(isInProgram("coral", "Invert"), false);
  });

  void test("an unknown species type belongs to no program", () => {
    assert.strictEqual(isInProgram("fish", null), false);
    assert.strictEqual(isInProgram("fish", undefined), false);
    assert.strictEqual(isInProgram("fish", "Fungus"), false);
  });

  void test("the any-program predicate covers every program's species types", () => {
    const sql = anyProgramSpeciesTypeSql("s");
    for (const speciesType of ["Fish", "Invert", "Plant", "Coral"]) {
      assert.ok(sql.includes(`'${speciesType}'`), `${speciesType} missing from ${sql}`);
    }
    assert.ok(sql.startsWith("s.species_type IN ("));
  });
});

void describe("Points - SQL fragment agrees with the TypeScript function", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    const database = await createTestDatabase({ foreignKeys: "off", migrations: "latest" });
    ctx = { ...database, ...(await createTestActors(database.db)) };
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  /** Inserts every table case, preserving order, and returns the row ids. */
  async function insertCases(): Promise<number[]> {
    const ids: number[] = [];
    for (const { program, speciesType, row } of cases) {
      const result = await ctx.db.run(
        `INSERT INTO submissions (
          member_id, program, species_type, species_class,
          species_common_name, species_latin_name, submitted_on, approved_on,
          points, article_points, first_time_species, cares_species,
          flowered, sexual_reproduction
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ctx.member.id,
          program,
          speciesType,
          "Test Class",
          "Test Species",
          "Testus specius",
          "2024-01-01",
          "2024-01-02",
          row.points ?? null,
          row.article_points ?? null,
          toFlag(row.first_time_species),
          toFlag(row.cares_species),
          toFlag(row.flowered),
          toFlag(row.sexual_reproduction),
        ]
      );
      ids.push(result.lastID as number);
    }
    return ids;
  }

  /** Stores flags the way the approval writer does: 0/1 integers, or NULL. */
  function toFlag(value: boolean | number | null | undefined) {
    if (value === null || value === undefined) {
      return null;
    }
    return value ? 1 : 0;
  }

  void test("fragment with the bare table name matches row for row", async () => {
    const ids = await insertCases();
    const rows = await ctx.db.all<{ id: number; total: number }[]>(
      `SELECT submissions.id, ${totalPointsSql("submissions")} as total
       FROM submissions ORDER BY submissions.id`
    );

    assert.strictEqual(rows.length, cases.length);
    rows.forEach((sqlRow, i) => {
      assert.strictEqual(sqlRow.id, ids[i]);
      assert.strictEqual(sqlRow.total, totalPoints(cases[i].row), cases[i].name);
      assert.strictEqual(sqlRow.total, cases[i].expected, cases[i].name);
    });
  });

  void test("fragment with the short alias matches row for row", async () => {
    await insertCases();
    const rows = await ctx.db.all<{ total: number }[]>(
      `SELECT ${totalPointsSql("s")} as total FROM submissions s ORDER BY s.id`
    );

    assert.strictEqual(rows.length, cases.length);
    rows.forEach((sqlRow, i) => {
      assert.strictEqual(sqlRow.total, cases[i].expected, cases[i].name);
    });
  });

  void test("SQL species type predicate selects the same rows as the TypeScript one", async () => {
    await insertCases();

    for (const program of ["fish", "plant", "coral"] as ProgramType[]) {
      const rows = await ctx.db.all<{ total: number }[]>(
        `SELECT ${totalPointsSql("s")} as total
         FROM submissions s
         WHERE ${programSpeciesTypeSql("s", program)}
         ORDER BY s.id`
      );
      const expected = cases
        .filter((c) => isInProgram(program, c.speciesType))
        .map((c) => c.expected);

      assert.deepStrictEqual(
        rows.map((r) => r.total),
        expected,
        `program ${program}`
      );
    }
  });

  /**
   * The admin API's member detail reports one cross-program grand total while the
   * roster reports three per-program totals. They must be the same arithmetic,
   * so a row belonging to no program - or approved but never submitted - must
   * not be counted by one surface and left out by the other.
   */
  void test("the cross-program grand total equals the sum of the per-program totals", async () => {
    await insertCases();

    // A row the roster's per-program filters exclude, which a grand total
    // filtered only on approval would wrongly pick up. (A species type in no
    // program cannot be stored at all - the submissions table CHECKs
    // species_type IN ('Fish', 'Plant', 'Invert', 'Coral') - so the only
    // divergence reachable in practice is the submitted_on filter.)
    await ctx.db.run(
      `INSERT INTO submissions (
        member_id, program, species_type, species_class, species_common_name,
        species_latin_name, submitted_on, approved_on, points
      ) VALUES (?, 'fish', 'Fish', 'Test Class', 'Never submitted', 'Testus latens', NULL, '2024-01-02', 900)`,
      [ctx.member.id]
    );

    const grand = await ctx.db.get<{ total: number }>(
      `SELECT SUM(${totalPointsSql("submissions")}) as total
       FROM submissions
       WHERE submissions.approved_on IS NOT NULL
         AND submissions.submitted_on IS NOT NULL
         AND ${anyProgramSpeciesTypeSql("submissions")}`
    );

    let perProgram = 0;
    for (const program of ["fish", "plant", "coral"] as ProgramType[]) {
      const row = await ctx.db.get<{ total: number | null }>(
        `SELECT SUM(${totalPointsSql("submissions")}) as total
         FROM submissions
         WHERE submissions.approved_on IS NOT NULL
           AND submissions.submitted_on IS NOT NULL
           AND ${programSpeciesTypeSql("submissions", program)}`
      );
      perProgram += row?.total ?? 0;
    }

    assert.strictEqual(grand?.total, perProgram);
    // And neither surface counted the excluded row.
    const everything = await ctx.db.get<{ total: number }>(
      `SELECT SUM(${totalPointsSql("submissions")}) as total FROM submissions`
    );
    assert.strictEqual((everything?.total ?? 0) - perProgram, 900);
  });
});

/**
 * Which bonuses a member can still earn after approval, so the witness email
 * names only those: an article they have not yet written, and on HAP a plant
 * that has not yet flowered or reproduced sexually. CARES is a fact about the
 * Species and first-time is approval's, so neither is ever "still possible".
 */
void describe("Points - bonuses still possible after approval", () => {
  void test("a BAP row with no article can still earn the article bonus, and nothing else", () => {
    assert.deepStrictEqual(bonusesStillPossible("fish", { points: 10, cares_species: true }), ["article_points"]);
  });

  void test("an article already counted is not still possible", () => {
    assert.deepStrictEqual(bonusesStillPossible("fish", { points: 10, article_points: 5 }), []);
    assert.deepStrictEqual(bonusesStillPossible("coral", { points: 10, article_points: 10 }), []);
  });

  void test("a HAP row names flowering and sexual reproduction while they are unset, in the formula's order", () => {
    assert.deepStrictEqual(bonusesStillPossible("plant", { points: 10 }), [
      "article_points",
      "flowered",
      "sexual_reproduction",
    ]);
    assert.deepStrictEqual(bonusesStillPossible("plant", { points: 10, flowered: 1, article_points: 5 }), [
      "sexual_reproduction",
    ]);
    assert.deepStrictEqual(
      bonusesStillPossible("plant", { points: 10, flowered: true, sexual_reproduction: true, article_points: 10 }),
      []
    );
  });

  void test("CARES and first-time are never still possible", () => {
    for (const program of ["fish", "plant", "coral"] as ProgramType[]) {
      const possible = bonusesStillPossible(program, { points: 10 });
      assert.ok(!possible.includes("cares_species"));
      assert.ok(!possible.includes("first_time_species"));
    }
  });

  void test("a Program the rule does not know carries only the article bonus", () => {
    assert.deepStrictEqual(bonusesStillPossible("hamster", { points: 10 }), ["article_points"]);
  });
});
