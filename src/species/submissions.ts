import { query } from "@/db/conn";
import type { SubmissionAlias } from "@/points";

/**
 * The Species a Submission is bound to, as a SQL expression over the
 * Submission's row: NULL when it is bound to none.
 *
 * This is the one definition of the Species-Submission relation: the
 * Submission's own `species_id`. Compose it the way queries compose
 * `totalPointsSql`: `WHERE ${speciesIdOfSubmissionSql("s")} = ?`.
 */
export function speciesIdOfSubmissionSql(alias: SubmissionAlias): string {
  return `${alias}.species_id`;
}

/** How many Submissions reference the Species, and how many of those are approved. */
export async function countSubmissionsOfSpecies(
  speciesId: number
): Promise<{ total: number; approved: number }> {
  const rows = await query<{ total: number; approved: number | null }>(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN s.approved_on IS NOT NULL THEN 1 ELSE 0 END) AS approved
     FROM submissions s
     WHERE ${speciesIdOfSubmissionSql("s")} = ?`,
    [speciesId]
  );
  return { total: rows[0]?.total ?? 0, approved: rows[0]?.approved ?? 0 };
}

/**
 * How many approved Submissions each of these Species has, in one query for
 * a page of them: the approval queue previews first-time for every row it
 * lists. A Species with none is absent from the map, so read it with
 * `?? 0`.
 */
export async function countApprovedBySpecies(speciesIds: number[]): Promise<Map<number, number>> {
  const ids = [...new Set(speciesIds)];
  if (ids.length === 0) return new Map();
  const rows = await query<{ species_id: number; approved: number }>(
    `SELECT s.species_id, COUNT(*) AS approved
     FROM submissions s
     WHERE ${speciesIdOfSubmissionSql("s")} IN (${ids.map(() => "?").join(", ")})
       AND s.approved_on IS NOT NULL
     GROUP BY s.species_id`,
    ids
  );
  return new Map(rows.map((row) => [row.species_id, row.approved]));
}
