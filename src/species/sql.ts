/**
 * SQL fragments for modules that read a Species alongside their own tables.
 *
 * Other modules never write the species tables, and never name them: a query
 * that needs a Species' columns composes these, the way queries compose
 * `totalPointsSql` from `src/points.ts`. When the tables change, these change
 * and every query follows.
 */
import type { SubmissionAlias } from "@/points";
import { nameTable } from "./names";
import { speciesIdOfSubmissionSql } from "./submissions";
import type { NameKind } from "./types";

/** The Species table under an alias, for a FROM clause: `FROM ${speciesFromSql("sng")}`. */
export function speciesFromSql(alias: string): string {
  return `species_name_group ${alias}`;
}

/**
 * Join the Species whose id is `speciesIdExpr` under `alias`. A LEFT JOIN
 * unless `required`, when rows without a Species drop out.
 */
export function speciesJoinSql(
  speciesIdExpr: string,
  alias: string,
  { required = false }: { required?: boolean } = {}
): string {
  return `${required ? "JOIN" : "LEFT JOIN"} species_name_group ${alias} ON ${alias}.group_id = ${speciesIdExpr}`;
}

/** Join the Species a Submission is bound to, under `alias`; NULL columns when it is bound to none. */
export function speciesOfSubmissionJoinSql(submission: SubmissionAlias, alias: string): string {
  return speciesJoinSql(speciesIdOfSubmissionSql(submission), alias);
}

/**
 * The Program class of a Submission's Species, joined as `speciesAlias` by
 * `speciesOfSubmissionJoinSql`. A Submission bound to no Species (approved
 * before binding was required) falls back to the class the member entered, so
 * it keeps counting toward Specialty awards.
 */
export function programClassOfSubmissionSql(submission: SubmissionAlias, speciesAlias: string): string {
  return `COALESCE(${speciesAlias}.program_class, ${submission}.species_class)`;
}

/** One Name of the kind for the Species `speciesIdExpr`, or NULL: a scalar subquery. */
export function anyNameSql(kind: NameKind, speciesIdExpr: string): string {
  const t = nameTable[kind];
  return `(SELECT ${t.text} FROM ${t.table} WHERE group_id = ${speciesIdExpr} LIMIT 1)`;
}
