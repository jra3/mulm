import { getMember, grantAward, revokeAward } from "./db/members";
import { checkMetaAwards, evaluateMetaAwards } from "./specialtyAwards";
import { query } from "./db/conn";
import { logger } from "./utils/logger";
import { getSpecialtyAwardEvaluations } from "./db/specialtyAwards";

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

  const evaluations = await getSpecialtyAwardEvaluations(memberId);
  const existingAwards = await getExistingSpecialtyAwards(memberId);

  const earnedSpecialty = evaluations
    .filter((evaluation) => evaluation.qualified)
    .map(({ award }) => award.name);
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
export async function getSpecialtyAwardProgress(memberId: number): Promise<{
  specialtyProgress: SpecialtyAwardProgress[];
  metaProgress: MetaAwardProgress[];
}> {
  const evaluations = await getSpecialtyAwardEvaluations(memberId);
  const existingAwards = await getExistingSpecialtyAwards(memberId);

  // Account presentation: cap percentages, require qualification AND a grant,
  // and defer a failed limitation until the species threshold has been reached.
  const specialtyProgress: SpecialtyAwardProgress[] = evaluations.map((evaluation) => {
    const { award, count, requiredCount, qualified, limitationMet, distinctSpecies } = evaluation;
    const granted = existingAwards.includes(award.name);
    return {
      name: award.name,
      requiredSpecies: requiredCount,
      currentSpecies: count,
      percentage: Math.min(100, Math.round((count / requiredCount) * 100)),
      isCompleted: qualified && granted,
      isLimitationMet: count < requiredCount || limitationMet,
      limitationDescription: award.limitations?.description || null,
      speciesList: distinctSpecies,
    };
  });

  // This page counts only currently qualified, granted specialties toward meta progress.
  const completedNames = specialtyProgress
    .filter((award) => award.isCompleted)
    .map((award) => award.name);
  const metaProgress: MetaAwardProgress[] = evaluateMetaAwards(completedNames).map(
    (evaluation) => ({
      name: evaluation.award.name,
      requiredAwards: evaluation.requiredCount,
      currentAwards: evaluation.count,
      percentage: Math.min(100, Math.round((evaluation.count / evaluation.requiredCount) * 100)),
      isCompleted: existingAwards.includes(evaluation.award.name),
      completedSpecialtyAwards: evaluation.countedAwards,
    })
  );

  return { specialtyProgress, metaProgress };
}
