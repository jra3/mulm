import { getMember, grantAward } from './db/members';
import { checkSpecialtyAwards, checkMetaAwards, SubmissionForAward } from './specialtyAwards';
import { query } from './db/conn';
import { logger } from './utils/logger';

/**
 * Get approved submissions for a member with genus information for specialty award checking
 *
 * **Migration Note**: Updated to check all three FK columns in submissions table
 * (species_name_id, common_name_id, scientific_name_id) to get canonical_genus
 * from species_name_group via the split schema.
 */
async function getSubmissionsWithGenus(memberId: number): Promise<SubmissionForAward[]> {
  const submissions = await query<{
		species_class: string;
		species_latin_name: string;
		species_type: string;
		water_type: string;
		spawn_locations: string;
		canonical_genus: string | null;
	}>(`
		SELECT
			s.species_class,
			s.species_latin_name,
			s.species_type,
			s.water_type,
			s.spawn_locations,
			COALESCE(
				sng_legacy.canonical_genus,
				sng_common.canonical_genus,
				sng_scientific.canonical_genus
			) as canonical_genus
		FROM submissions s
		LEFT JOIN species_name sn ON s.species_name_id = sn.name_id
		LEFT JOIN species_name_group sng_legacy ON sn.group_id = sng_legacy.group_id
		LEFT JOIN species_common_name cn ON s.common_name_id = cn.common_name_id
		LEFT JOIN species_name_group sng_common ON cn.group_id = sng_common.group_id
		LEFT JOIN species_scientific_name scin ON s.scientific_name_id = scin.scientific_name_id
		LEFT JOIN species_name_group sng_scientific ON scin.group_id = sng_scientific.group_id
		WHERE s.member_id = ?
			AND s.submitted_on IS NOT NULL
			AND s.approved_on IS NOT NULL
	`, [memberId]);

  return submissions.map(sub => ({
    species_class: sub.species_class,
    species_latin_name: sub.species_latin_name,
    species_type: sub.species_type,
    water_type: sub.water_type,
    spawn_locations: sub.spawn_locations,
    canonical_genus: sub.canonical_genus || undefined
  }));
}

/**
 * Check if a member has earned any new specialty awards and grant them
 */
export async function checkAndGrantSpecialtyAwards(
  memberId: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: { disableEmails?: boolean }
): Promise<string[]> {
  try {
    const member = await getMember(memberId);
    if (!member) {
      throw new Error(`Member ${memberId} not found`);
    }

    // Get all approved submissions for this member with genus information
    const allSubmissions = await getSubmissionsWithGenus(memberId);

    // Check what specialty awards they've earned
    const earnedSpecialtyAwards = checkSpecialtyAwards(allSubmissions);
		
    // Get existing awards to avoid duplicates
    const existingAwards = await getExistingSpecialtyAwards(memberId);
		
    // Find new specialty awards
    const newSpecialtyAwards = earnedSpecialtyAwards.filter(award => !existingAwards.includes(award));
		
    // Grant new specialty awards
    const grantedAwards: string[] = [];
		
    for (const awardName of newSpecialtyAwards) {
      try {
        await grantAward(memberId, awardName, new Date(), 'species');
        grantedAwards.push(awardName);
        logger.info(`Granted specialty award "${awardName}" to member ${memberId} (${member.display_name})`);
      } catch (error) {
        logger.error(`Failed to grant specialty award "${awardName}" to member ${memberId}:`, error);
      }
    }
		
    // Check for meta-awards after granting new specialty awards
    const updatedExistingAwards = [...existingAwards, ...grantedAwards];
    const earnedMetaAwards = checkMetaAwards(updatedExistingAwards);
		
    // Grant new meta-awards
    for (const awardName of earnedMetaAwards) {
      try {
        await grantAward(memberId, awardName, new Date(), 'meta_species');
        grantedAwards.push(awardName);
        logger.info(`Granted meta-award "${awardName}" to member ${memberId} (${member.display_name}) - achieved through ${updatedExistingAwards.filter(a => !a.includes('Specialist Award')).length} specialty awards`);
      } catch (error) {
        logger.error(`Failed to grant meta-award "${awardName}" to member ${memberId}:`, error);
      }
    }

    // TODO: Send email notification if not disabled
    // if (!options?.disableEmails && grantedAwards.length > 0) {
    //     for (const awardName of grantedAwards) {
    //         await onSpecialtyAward(member, awardName);
    //     }
    // }

    return grantedAwards;

  } catch (error) {
    logger.error(`Error checking specialty awards for member ${memberId}:`, error);
    throw error;
  }
}

/**
 * Get existing specialty award names for a member
 */
async function getExistingSpecialtyAwards(memberId: number): Promise<string[]> {
  try {
    const { query } = await import('./db/conn');
    const awards = await query<{ award_name: string }>(
      "SELECT award_name FROM awards WHERE member_id = ?",
      [memberId]
    );
    return awards.map(award => award.award_name);
  } catch (error) {
    logger.error(`Failed to get existing awards for member ${memberId}:`, error);
    return [];
  }
}

/**
 * Check all specialty awards for a member (convenience function that calls checkAndGrantSpecialtyAwards)
 */
export async function checkAllSpecialtyAwards(
  memberId: number,
  options?: { disableEmails?: boolean }
): Promise<string[]> {
  return checkAndGrantSpecialtyAwards(memberId, options);
}