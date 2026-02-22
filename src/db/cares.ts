import { query } from './conn';

export interface CaresStats {
  speciesCount: number;
  memberCount: number;
}

/**
 * Get BAS-wide CARES participation statistics.
 * - speciesCount: number of distinct CARES species maintained by at least one member
 * - memberCount: number of distinct members maintaining at least one CARES species
 */
export async function getCaresStats(): Promise<CaresStats> {
  const rows = await query<{ species_count: number; member_count: number }>(
    `SELECT
      COUNT(DISTINCT sc.group_id) AS species_count,
      COUNT(DISTINCT sc.member_id) AS member_count
    FROM species_collection sc
    JOIN species_name_group sng ON sc.group_id = sng.group_id
    WHERE sng.is_cares_species = 1
      AND sc.removed_date IS NULL`
  );

  return {
    speciesCount: rows[0]?.species_count ?? 0,
    memberCount: rows[0]?.member_count ?? 0,
  };
}

/**
 * Check if a member is participating in CARES (has at least one registered CARES species).
 */
export async function isMemberCaresParticipant(memberId: number): Promise<boolean> {
  const rows = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
    FROM species_collection sc
    JOIN species_name_group sng ON sc.group_id = sng.group_id
    WHERE sc.member_id = ?
      AND sng.is_cares_species = 1
      AND sc.removed_date IS NULL`,
    [memberId]
  );
  return (rows[0]?.cnt ?? 0) > 0;
}

/**
 * Get count of CARES species a member is maintaining.
 */
export async function getMemberCaresCount(memberId: number): Promise<number> {
  const rows = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
    FROM species_collection sc
    JOIN species_name_group sng ON sc.group_id = sng.group_id
    WHERE sc.member_id = ?
      AND sng.is_cares_species = 1
      AND sc.removed_date IS NULL`,
    [memberId]
  );
  return rows[0]?.cnt ?? 0;
}
