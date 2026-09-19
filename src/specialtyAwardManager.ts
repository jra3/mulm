import { getMember, grantAward, revokeAward } from "./db/members";
import {
  checkSpecialtyAwards,
  checkMetaAwards,
  getCountableSpecialtyAwards,
  metaAwards,
  specialtyAwards,
  SubmissionForAward,
} from "./specialtyAwards";
import { query } from "./db/conn";
import { logger } from "./utils/logger";

/**
 * Get approved submissions for a member with genus information for specialty award checking
 *
 * Uses split schema FK columns (common_name_id, scientific_name_id) to get canonical_genus
 * from species_name_group.
 */
async function getSubmissionsWithGenus(memberId: number): Promise<SubmissionForAward[]> {
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
			s.species_class,
			s.species_latin_name,
			s.species_type,
			s.water_type,
			s.spawn_locations,
			COALESCE(
				sng_common.canonical_genus,
				sng_scientific.canonical_genus
			) as canonical_genus
		FROM submissions s
		LEFT JOIN species_common_name cn ON s.common_name_id = cn.common_name_id
		LEFT JOIN species_name_group sng_common ON cn.group_id = sng_common.group_id
		LEFT JOIN species_scientific_name scin ON s.scientific_name_id = scin.scientific_name_id
		LEFT JOIN species_name_group sng_scientific ON scin.group_id = sng_scientific.group_id
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

/**
 * Bring a member's Specialty Awards into line with their approved Submissions.
 *
 * Symmetric: it grants what they have earned and takes back what they no
 * longer qualify for. The asymmetric version this replaced could only ever
 * grant, so a committee member correcting a misidentified species left the
 * Award it had earned standing on evidence that no longer existed.
 *
 * Meta-awards are recomputed from the resulting specialty set, so revoking a
 * specialty award can revoke the Senior or Expert Specialist Award above it.
 *
 * Returns what changed. It sends nothing - the lifecycle module owns who is
 * told, and the nightly sweep and the progress page reach this on their own.
 */
export async function recomputeSpecialtyAwards(
  memberId: number
): Promise<{ granted: string[]; revoked: string[] }> {
  const member = await getMember(memberId);
  if (!member) {
    throw new Error(`Member ${memberId} not found`);
  }

  const allSubmissions = await getSubmissionsWithGenus(memberId);
  const existingAwards = await getExistingSpecialtyAwards(memberId);

  const earnedSpecialty = checkSpecialtyAwards(allSubmissions);
  const earnedMeta = checkMetaAwards(earnedSpecialty);
  const earned = new Set([...earnedSpecialty, ...earnedMeta]);

  // Only the awards this computation owns are candidates for revocation; an
  // award granted by hand is not the recompute's to take back.
  const computed = new Set(await getComputedAwardNames(memberId));

  const granted: string[] = [];
  const revoked: string[] = [];

  for (const awardName of earned) {
    if (existingAwards.includes(awardName)) {
      continue;
    }
    const isMeta = earnedMeta.includes(awardName);
    try {
      await grantAward(memberId, awardName, new Date(), isMeta ? "meta_species" : "species");
      granted.push(awardName);
      logger.info(
        `Granted ${isMeta ? "meta-award" : "specialty award"} "${awardName}" to member ${memberId} (${member.display_name})`
      );
    } catch (error) {
      logger.error(`Failed to grant award "${awardName}" to member ${memberId}:`, error);
    }
  }

  for (const awardName of existingAwards) {
    if (earned.has(awardName) || !computed.has(awardName)) {
      continue;
    }
    try {
      await revokeAward(memberId, awardName);
      revoked.push(awardName);
      logger.info(
        `Revoked award "${awardName}" from member ${memberId} (${member.display_name}): no longer qualified`
      );
    } catch (error) {
      logger.error(`Failed to revoke award "${awardName}" from member ${memberId}:`, error);
    }
  }

  return { granted, revoked };
}

/**
 * Check if a member has earned any new specialty awards and grant them.
 * Kept for the surfaces that only ever want to top a member up - the admin
 * "check specialty awards" button and the nightly sweep.
 */
export async function checkAndGrantSpecialtyAwards(memberId: number): Promise<string[]> {
  const { granted } = await recomputeSpecialtyAwards(memberId);
  return granted;
}

/**
 * Get existing award names for a member, however they were granted.
 */
async function getExistingSpecialtyAwards(memberId: number): Promise<string[]> {
  try {
    const awards = await query<{ award_name: string }>(
      "SELECT award_name FROM awards WHERE member_id = ?",
      [memberId]
    );
    return awards.map((award) => award.award_name);
  } catch (error) {
    logger.error(`Failed to get existing awards for member ${memberId}:`, error);
    return [];
  }
}

/**
 * The awards this computation granted, as opposed to ones a committee member
 * entered by hand. Only these may be revoked when a member stops qualifying.
 */
async function getComputedAwardNames(memberId: number): Promise<string[]> {
  try {
    const awards = await query<{ award_name: string }>(
      "SELECT award_name FROM awards WHERE member_id = ? AND award_type IN ('species', 'meta_species')",
      [memberId]
    );
    return awards.map((award) => award.award_name);
  } catch (error) {
    logger.error(`Failed to get computed awards for member ${memberId}:`, error);
    return [];
  }
}

/**
 * Check all specialty awards for a member (convenience function that calls checkAndGrantSpecialtyAwards)
 */
export async function checkAllSpecialtyAwards(memberId: number): Promise<string[]> {
  return checkAndGrantSpecialtyAwards(memberId);
}

export interface SpecialtyAwardProgress {
  name: string;
  requiredSpecies: number;
  currentSpecies: number;
  percentage: number;
  isCompleted: boolean;
  isLimitationMet: boolean;
  limitationDescription: string | null;
  speciesList: string[];
}

export interface MetaAwardProgress {
  name: string;
  requiredAwards: number;
  currentAwards: number;
  percentage: number;
  isCompleted: boolean;
  completedSpecialtyAwards: string[];
}

/**
 * Get detailed progress for all specialty awards for a member
 * Shows current progress even if not completed
 */
export async function getSpecialtyAwardProgress(
  memberId: number
): Promise<{
  specialtyProgress: SpecialtyAwardProgress[];
  metaProgress: MetaAwardProgress[];
}> {
  // Get all approved submissions for this member
  const allSubmissions = await getSubmissionsWithGenus(memberId);

  // Get existing awards
  const existingAwards = await getExistingSpecialtyAwards(memberId);

  // Calculate progress for each specialty award
  const specialtyProgress: SpecialtyAwardProgress[] = specialtyAwards.map((award) => {
    // Filter submissions that match this award's eligibility criteria
    const eligibleSubmissions = allSubmissions.filter((sub) => award.eligibilityFilter(sub));

    // Get unique species (by latin name)
    const uniqueSpecies = new Set(
      eligibleSubmissions.map((sub) => sub.species_latin_name.toLowerCase())
    );

    const currentSpecies = uniqueSpecies.size;
    const requiredSpecies = award.requiredSpecies;
    const percentage = Math.min(100, Math.round((currentSpecies / requiredSpecies) * 100));

    // Check if limitation is met (if applicable)
    let isLimitationMet = true;
    if (award.limitations && currentSpecies >= requiredSpecies) {
      isLimitationMet = award.limitations.validator(eligibleSubmissions);
    }

    const isCompleted =
      currentSpecies >= requiredSpecies && isLimitationMet && existingAwards.includes(award.name);

    return {
      name: award.name,
      requiredSpecies,
      currentSpecies,
      percentage,
      isCompleted,
      isLimitationMet,
      limitationDescription: award.limitations?.description || null,
      speciesList: Array.from(uniqueSpecies),
    };
  });

  // Calculate meta-award progress
  const countableAwards = getCountableSpecialtyAwards();

  // Count completed specialty awards (excluding Marine Invertebrates for meta-awards)
  const completedSpecialtyAwards = specialtyProgress
    .filter((sp) => sp.isCompleted && countableAwards.includes(sp.name))
    .map((sp) => sp.name);

  const metaProgress: MetaAwardProgress[] = metaAwards.map((metaAward) => {
    const requiredAwards = metaAward.name === "Senior Specialist Award" ? 4 : 7;
    const currentAwards = completedSpecialtyAwards.length;
    const percentage = Math.min(100, Math.round((currentAwards / requiredAwards) * 100));
    const isCompleted = existingAwards.includes(metaAward.name);

    return {
      name: metaAward.name,
      requiredAwards,
      currentAwards,
      percentage,
      isCompleted,
      completedSpecialtyAwards,
    };
  });

  return {
    specialtyProgress,
    metaProgress,
  };
}
