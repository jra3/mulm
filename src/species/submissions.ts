import { query } from "@/db/conn";
import type { SubmissionAlias } from "@/points";

/**
 * The Species a Submission references, as a SQL expression over the
 * Submission's row: NULL when it references none.
 *
 * This is the one definition of the Species-Submission relation. Today a
 * Submission reaches its Species through whichever of its two Name foreign
 * keys is set; when Submissions gain their own `species_id` this becomes that
 * column and every query composing it follows. Compose it the way queries
 * compose `totalPointsSql`: `WHERE ${speciesIdOfSubmissionSql("s")} = ?`.
 */
export function speciesIdOfSubmissionSql(alias: SubmissionAlias): string {
  return `COALESCE(
    (SELECT cn.group_id FROM species_common_name cn WHERE cn.common_name_id = ${alias}.common_name_id),
    (SELECT sn.group_id FROM species_scientific_name sn WHERE sn.scientific_name_id = ${alias}.scientific_name_id)
  )`;
}

export type SubmissionOfSpecies = {
  id: number;
  member_id: number | null;
  species_common_name: string;
  species_latin_name: string;
  submitted_on: string | null;
  approved_on: string | null;
  points: number | null;
};

/** Every Submission, in any state, that references the Species. */
export async function listSubmissionsOfSpecies(speciesId: number): Promise<SubmissionOfSpecies[]> {
  return query<SubmissionOfSpecies>(
    `SELECT s.id, s.member_id, s.species_common_name, s.species_latin_name,
            s.submitted_on, s.approved_on, s.points
     FROM submissions s
     WHERE ${speciesIdOfSubmissionSql("s")} = ?
     ORDER BY s.id`,
    [speciesId]
  );
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

/** The id of the Species a Submission references, or null when it references none. */
export async function findSpeciesIdOfSubmission(submissionId: number): Promise<number | null> {
  const rows = await query<{ species_id: number | null }>(
    `SELECT ${speciesIdOfSubmissionSql("s")} AS species_id FROM submissions s WHERE s.id = ?`,
    [submissionId]
  );
  return rows[0]?.species_id ?? null;
}
