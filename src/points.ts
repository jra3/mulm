import * as z from "zod";
import { isProgramType, programMetadata, ProgramType } from "./programs";

/**
 * The Points rule, in one place.
 *
 * A submission's total is its base points plus the bonuses the committee
 * entered at approval time:
 *
 *   total = points
 *         + article_points
 *         + (first_time_species × 5)
 *         + (cares_species × 5)
 *         + (flowered × points)
 *         + (sexual_reproduction × points)
 *
 * The formula is uniform across programs. Which bonuses a program may carry
 * (CARES on BAP only; flowered and sexual reproduction on HAP only) is an
 * invariant enforced on write, not a condition in the sum.
 *
 * The rule is written here twice on purpose - once as a SQL fragment that
 * every total-reporting query composes, once as a TypeScript function for
 * displays and tests - and the tests prove the two forms agree.
 */

/** Flat bonus awarded for a first-time species and for a CARES-listed species. */
const FLAT_BONUS = 5;

/** The table aliases the codebase uses for `submissions`. */
export type SubmissionAlias = "submissions" | "s";

export type SpeciesType = "Fish" | "Invert" | "Plant" | "Coral";

/**
 * The fields the rule reads. Flags arrive as 0/1 integers from SQLite and as
 * booleans from the form schemas, so both shapes are accepted.
 */
export type PointsRow = {
  points?: number | null;
  article_points?: number | null;
  first_time_species?: boolean | number | null;
  cares_species?: boolean | number | null;
  flowered?: boolean | number | null;
  sexual_reproduction?: boolean | number | null;
};

/** Which species types count toward each program. */
const programSpeciesTypes: Record<ProgramType, SpeciesType[]> = {
  fish: ["Fish", "Invert"],
  plant: ["Plant"],
  coral: ["Coral"],
};

/**
 * The Points rule as a SQL expression over the submissions table.
 * Every column is qualified with `alias`, so the fragment is safe to drop into
 * a join or a sub-select. The alias type is the only guard needed.
 */
export function totalPointsSql(alias: SubmissionAlias): string {
  return [
    `${alias}.points`,
    `IFNULL(${alias}.article_points, 0)`,
    `(IFNULL(${alias}.first_time_species, 0) * ${FLAT_BONUS})`,
    `(IFNULL(${alias}.cares_species, 0) * ${FLAT_BONUS})`,
    `(IFNULL(${alias}.flowered, 0) * ${alias}.points)`,
    `(IFNULL(${alias}.sexual_reproduction, 0) * ${alias}.points)`,
  ].join(" + ");
}

/**
 * The Points rule as a TypeScript function, matching SQLite's
 * `IFNULL(flag, 0) * n` handling of null, boolean and 0/1 flag values.
 *
 * A submission with no base points yet (an unapproved one) totals 0 here,
 * where the SQL fragment yields NULL; either way it contributes nothing to a
 * SUM, and approved submissions always carry points.
 */
export function totalPoints(row: PointsRow): number {
  const base = row.points ?? 0;
  return (
    base +
    (row.article_points ?? 0) +
    flag(row.first_time_species) * FLAT_BONUS +
    flag(row.cares_species) * FLAT_BONUS +
    flag(row.flowered) * base +
    flag(row.sexual_reproduction) * base
  );
}

/** One itemised bonus, ready for display: a member-facing label and its amount. */
export type BonusLine = {
  label: string;
  amount: number;
};

/**
 * The bonuses a row actually carries, itemised for display, in the order the
 * formula above states them. A bonus that is not set yields no line.
 *
 * Base points are not a bonus, so they are not a line here; the caller shows
 * them separately. These amounts plus the row's base points equal
 * `totalPoints(row)`, which is what makes the approval email's list add up to
 * the total it prints.
 */
export function bonusBreakdown(row: PointsRow): BonusLine[] {
  const base = row.points ?? 0;
  const articlePoints = row.article_points ?? 0;
  const lines: BonusLine[] = [];

  if (articlePoints > 0) {
    lines.push({ label: "Article Bonus", amount: articlePoints });
  }
  if (flag(row.first_time_species)) {
    lines.push({ label: "First Time Species Bonus", amount: FLAT_BONUS });
  }
  if (flag(row.cares_species)) {
    lines.push({ label: "CARES Species Bonus", amount: FLAT_BONUS });
  }
  if (flag(row.flowered)) {
    lines.push({ label: "Flowering Bonus", amount: base });
  }
  if (flag(row.sexual_reproduction)) {
    lines.push({ label: "Sexual Reproduction Bonus", amount: base });
  }

  return lines;
}

/** Which submissions count toward a program, as SQL. */
export function programSpeciesTypeSql(alias: SubmissionAlias, program: ProgramType): string {
  const types = programSpeciesTypes[program].map((type) => `'${type}'`).join(", ");
  return `${alias}.species_type IN (${types})`;
}

/**
 * Which submissions count toward *some* program, as SQL. A cross-program grand
 * total composes this so that it equals the sum of the per-program totals: a
 * species type belonging to no program must not be counted by one surface and
 * left out by another.
 */
export function anyProgramSpeciesTypeSql(alias: SubmissionAlias): string {
  const types = Object.values(programSpeciesTypes)
    .flat()
    .map((type) => `'${type}'`)
    .join(", ");
  return `${alias}.species_type IN (${types})`;
}

/** Which submissions count toward a program, in TypeScript. */
export function isInProgram(program: ProgramType, speciesType: string | null | undefined): boolean {
  return programSpeciesTypes[program].some((type) => type === speciesType);
}

/** A bonus the committee can award, named for the column it is stored in. */
export type BonusField =
  | "article_points"
  | "first_time_species"
  | "cares_species"
  | "flowered"
  | "sexual_reproduction";

/** The bonuses every program carries. */
const everyProgram: readonly BonusField[] = ["article_points", "first_time_species"];

/**
 * Which bonuses each program may carry: the article and first-time species
 * bonuses everywhere, CARES on BAP (fish) only, flowered and sexual
 * reproduction on HAP (plant) only. The same rule the approval panel hides
 * checkboxes by, as data, so a schema or a template can read it instead of
 * restating it.
 */
export const programBonuses: Record<ProgramType, readonly BonusField[]> = {
  fish: [...everyProgram, "cares_species"],
  plant: [...everyProgram, "flowered", "sexual_reproduction"],
  coral: everyProgram,
};

/**
 * How a bonus is named to a committee member in a validation message. Declared
 * in the order the formula states the bonuses in, and the only place the set is
 * written out: the `Record` makes the compiler check it against `BonusField`,
 * and `bonusFields` below reads its keys rather than repeating them.
 */
const bonusNames: Record<BonusField, string> = {
  article_points: "article",
  first_time_species: "first-time species",
  cares_species: "CARES species",
  flowered: "flowered",
  sexual_reproduction: "sexual reproduction",
};

/**
 * Every bonus, in the order the formula states them. Exported so the approval
 * panel's error mixin loops over it instead of listing the fields a third time.
 */
export const bonusFields: readonly BonusField[] = Object.keys(bonusNames) as BonusField[];

/** The bonus fields a refinement reads, as the form schemas produce them. */
export type BonusFields = Partial<Record<BonusField, boolean | number | null>>;

/**
 * A Zod refinement that rejects a bonus the submission's program cannot carry:
 * one issue per offending field, on that field's own path, so the error map
 * lands the message at the control that set it.
 *
 * Rejection, not correction - nothing is zeroed silently. Through the approval
 * panel an inapplicable flag cannot be sent, so its arrival means a stale form,
 * a bug, or a hand-crafted request, all of which should be visible.
 *
 * Attach it to the object schema the program's form parses:
 *
 *   approvalFields.superRefine(refineProgramBonuses(program))
 *
 * Note that an object-level refinement does not run when the base parse fails,
 * so a body that is also missing a required field reports only that.
 *
 * `program` is the plain string the submissions table stores; a name that is
 * not one of our programs carries only the bonuses every program carries.
 */
export function refineProgramBonuses(program: string) {
  const valid = bonusesForProgram(program);

  return (fields: BonusFields, ctx: z.core.$RefinementCtx): void => {
    for (const bonus of bonusFields) {
      if (!flag(fields[bonus]) || valid.includes(bonus)) {
        continue;
      }
      ctx.addIssue({
        code: "custom",
        path: [bonus],
        message: `The ${bonusNames[bonus]} bonus does not apply to ${programName(program)} submissions`,
      });
    }
  };
}

function bonusesForProgram(program: string): readonly BonusField[] {
  return isProgramType(program) ? programBonuses[program] : everyProgram;
}

function programName(program: string): string {
  return isProgramType(program) ? programMetadata[program].name : program;
}

function flag(value: boolean | number | null | undefined): number {
  return value ? Number(value) : 0;
}
