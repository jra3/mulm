import { query } from "./conn";
import { programClassOfSubmissionSql, speciesOfSubmissionJoinSql } from "@/species";
import { evaluateSpecialtyAwards, type SubmissionForAward } from "@/specialtyAwards";

/**
 * Get approved submissions for a member with genus information for specialty award checking
 *
 * The Program class and genus are the bound Species', joined through the
 * catalogue's one definition of that relation, so a Species moved to another
 * Program class moves its Submissions' awards with it (see
 * `programClassOfSubmissionSql` for the unbound case).
 */
export async function getApprovedSubmissionsForAwards(
  memberId: number
): Promise<SubmissionForAward[]> {
  const submissions = await query<{
    species_class: string;
    species_latin_name: string;
    species_type: string;
    water_type: string;
    spawn_locations: string;
    canonical_genus: string | null;
  }>(
    `
		SELECT
			${programClassOfSubmissionSql("s", "sng")} AS species_class,
			s.species_latin_name,
			s.species_type,
			s.water_type,
			s.spawn_locations,
			sng.canonical_genus
		FROM submissions s
		${speciesOfSubmissionJoinSql("s", "sng")}
		WHERE s.member_id = ?
			AND s.submitted_on IS NOT NULL
			AND s.approved_on IS NOT NULL
	`,
    [memberId]
  );

  return submissions.map((sub) => ({
    species_class: sub.species_class,
    species_latin_name: sub.species_latin_name,
    species_type: sub.species_type,
    water_type: sub.water_type,
    spawn_locations: sub.spawn_locations,
    canonical_genus: sub.canonical_genus || undefined,
  }));
}

/** Shared qualification read model for recomputation and both live progress pages. */
export async function getSpecialtyAwardEvaluations(memberId: number) {
  return evaluateSpecialtyAwards(await getApprovedSubmissionsForAwards(memberId));
}
