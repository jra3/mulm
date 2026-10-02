import { query, writeConn } from './conn';
import { anyNameSql, speciesFromSql, speciesJoinSql } from "@/species";

export interface CaresRegistration {
  group_id: number;
  common_name: string | null;
  scientific_name: string | null;
  registered_at: string;
  last_confirmed: string | null;
  photo_url: string | null;
  // Seal flags
  has_photo: boolean;
  has_article: boolean;
  has_internal_share: boolean;
  has_external_share: boolean;
  is_longevity: boolean;
  // Counts
  article_count: number;
  fry_share_count: number;
}

export interface CaresArticle {
  id: number;
  title: string;
  url: string | null;
  published_date: string | null;
  species_common_name: string | null;
  species_scientific_name: string | null;
  group_id: number;
}

export interface CaresFryShare {
  id: number;
  recipient_name: string;
  recipient_club: string | null;
  share_date: string;
  notes: string | null;
  species_common_name: string | null;
  species_scientific_name: string | null;
  group_id: number;
  is_external: boolean;
}

export interface CaresProfile {
  registrations: CaresRegistration[];
  articles: CaresArticle[];
  fryShares: CaresFryShare[];
}

interface RegistrationRow {
  group_id: number;
  common_name: string | null;
  scientific_name: string | null;
  registered_at: string;
  last_confirmed: string | null;
  photo_url: string | null;
  has_photo: number;
  article_count: number;
  internal_share_count: number;
  external_share_count: number;
  years_confirmed: number;
}

interface ArticleRow {
  id: number;
  title: string;
  url: string | null;
  published_date: string | null;
  common_name: string | null;
  scientific_name: string | null;
  species_group_id: number;
}

interface FryShareRow {
  id: number;
  recipient_name: string;
  recipient_club: string | null;
  share_date: string;
  notes: string | null;
  common_name: string | null;
  scientific_name: string | null;
  species_group_id: number;
  is_external: number;
}

/**
 * The Species of a member's current collection entry, and that member's CARES
 * registration for it if any. Registrations belong to the member and Species,
 * not to the entry: the entry is how a member reaches them from a card.
 */
async function entryRegistration(collectionEntryId: number, memberId: number) {
  const rows = await query<{
    group_id: number | null;
    is_cares_species: number | null;
    registered_at: string | null;
    photo_key: string | null;
    photo_url: string | null;
  }>(
    `SELECT c.group_id, sng.is_cares_species, r.registered_at, r.photo_key, r.photo_url
     FROM species_collection c
     ${speciesJoinSql("c.group_id", "sng")}
     LEFT JOIN cares_registration r
       ON r.member_id = c.member_id AND r.species_group_id = c.group_id
     WHERE c.id = ? AND c.member_id = ? AND c.removed_date IS NULL`,
    [collectionEntryId, memberId]
  );
  return rows[0] ?? null;
}

/**
 * Register the Species of a member's collection entry for the CARES program,
 * with the photo that earns its Gold seal.
 */
export async function registerForCares(
  collectionEntryId: number,
  memberId: number,
  photoKey: string,
  photoUrl: string
): Promise<void> {
  const entry = await entryRegistration(collectionEntryId, memberId);

  if (!entry) {
    throw new Error('Collection entry not found or access denied');
  }

  if (!entry.group_id) {
    throw new Error('Only species linked to the database can be registered for CARES');
  }

  if (!entry.is_cares_species) {
    throw new Error('This species is not part of the CARES priority list');
  }

  if (entry.registered_at) {
    throw new Error('This species is already registered for CARES');
  }

  const stmt = await writeConn.prepare(`
    INSERT INTO cares_registration (member_id, species_group_id, photo_key, photo_url)
    VALUES (?, ?, ?, ?)
  `);

  try {
    await stmt.run(memberId, entry.group_id, photoKey, photoUrl);
  } finally {
    await stmt.finalize();
  }
}

/**
 * Replace the photo of the CARES registration reached through a collection entry.
 */
export async function updateCaresPhoto(
  collectionEntryId: number,
  memberId: number,
  photoKey: string,
  photoUrl: string
): Promise<{ oldPhotoKey: string | null }> {
  const entry = await entryRegistration(collectionEntryId, memberId);

  if (!entry) {
    throw new Error('Collection entry not found or access denied');
  }

  if (!entry.registered_at) {
    throw new Error('This species is not registered for CARES');
  }

  const stmt = await writeConn.prepare(`
    UPDATE cares_registration
    SET photo_key = ?, photo_url = ?
    WHERE member_id = ? AND species_group_id = ?
  `);

  try {
    await stmt.run(photoKey, photoUrl, memberId, entry.group_id);
  } finally {
    await stmt.finalize();
  }

  return { oldPhotoKey: entry.photo_key };
}

/**
 * Check if a specific collection entry is CARES-eligible and its registration status.
 */
export async function getCaresEligibility(
  collectionEntryId: number,
  memberId: number
): Promise<{
  eligible: boolean;
  registered: boolean;
  photoUrl: string | null;
} | null> {
  const entry = await entryRegistration(collectionEntryId, memberId);
  if (!entry) return null;

  return {
    eligible: Boolean(entry.is_cares_species),
    registered: Boolean(entry.registered_at),
    photoUrl: entry.photo_url,
  };
}

/**
 * Get CARES profile data for a member: registrations with seal info,
 * articles, and fry sharing history.
 */
export async function getCaresProfile(memberId: number): Promise<CaresProfile> {
  // Get CARES registrations with seal calculations
  const registrations = await query<RegistrationRow>(
    `SELECT
      r.species_group_id AS group_id,
      ${anyNameSql("common", "r.species_group_id")} AS common_name,
      sng.canonical_genus || ' ' || sng.canonical_species_name AS scientific_name,
      r.registered_at,
      r.last_confirmed,
      r.photo_url,
      CASE WHEN r.photo_key IS NOT NULL THEN 1 ELSE 0 END AS has_photo,
      (
        SELECT COUNT(*) FROM cares_article ca
        WHERE ca.member_id = r.member_id AND ca.species_group_id = r.species_group_id
      ) AS article_count,
      (
        SELECT COUNT(*) FROM cares_fry_share fs
        WHERE fs.member_id = r.member_id AND fs.species_group_id = r.species_group_id
          AND fs.recipient_member_id IS NOT NULL
      ) AS internal_share_count,
      (
        SELECT COUNT(*) FROM cares_fry_share fs
        WHERE fs.member_id = r.member_id AND fs.species_group_id = r.species_group_id
          AND fs.recipient_club IS NOT NULL AND fs.recipient_member_id IS NULL
      ) AS external_share_count,
      CASE
        WHEN r.last_confirmed IS NOT NULL
          AND julianday(r.last_confirmed) - julianday(r.registered_at) >= 730
        THEN 1
        ELSE 0
      END AS years_confirmed
    FROM cares_registration r
    ${speciesJoinSql("r.species_group_id", "sng")}
    WHERE r.member_id = ?
    ORDER BY r.registered_at DESC`,
    [memberId]
  );

  // Get articles
  const articles = await query<ArticleRow>(
    `SELECT
      ca.id,
      ca.title,
      ca.url,
      ca.published_date,
      COALESCE(
        ${anyNameSql("common", "ca.species_group_id")},
        NULL
      ) AS common_name,
      COALESCE(
        sng.canonical_genus || ' ' || sng.canonical_species_name,
        NULL
      ) AS scientific_name,
      ca.species_group_id
    FROM cares_article ca
    ${speciesJoinSql("ca.species_group_id", "sng")}
    WHERE ca.member_id = ?
    ORDER BY ca.published_date DESC, ca.created_at DESC`,
    [memberId]
  );

  // Get fry shares
  const fryShares = await query<FryShareRow>(
    `SELECT
      fs.id,
      fs.recipient_name,
      fs.recipient_club,
      fs.share_date,
      fs.notes,
      COALESCE(
        ${anyNameSql("common", "fs.species_group_id")},
        NULL
      ) AS common_name,
      COALESCE(
        sng.canonical_genus || ' ' || sng.canonical_species_name,
        NULL
      ) AS scientific_name,
      fs.species_group_id,
      CASE WHEN fs.recipient_member_id IS NULL AND fs.recipient_club IS NOT NULL THEN 1 ELSE 0 END AS is_external
    FROM cares_fry_share fs
    ${speciesJoinSql("fs.species_group_id", "sng")}
    WHERE fs.member_id = ?
    ORDER BY fs.share_date DESC, fs.created_at DESC`,
    [memberId]
  );

  return {
    registrations: registrations.map((r) => ({
      group_id: r.group_id,
      common_name: r.common_name,
      scientific_name: r.scientific_name,
      registered_at: r.registered_at,
      last_confirmed: r.last_confirmed,
      photo_url: r.photo_url,
      has_photo: Boolean(r.has_photo),
      has_article: r.article_count > 0,
      has_internal_share: r.internal_share_count > 0,
      has_external_share: r.external_share_count > 0,
      is_longevity: Boolean(r.years_confirmed),
      article_count: r.article_count,
      fry_share_count: r.internal_share_count + r.external_share_count,
    })),
    articles: articles.map((a) => ({
      id: a.id,
      title: a.title,
      url: a.url,
      published_date: a.published_date,
      species_common_name: a.common_name,
      species_scientific_name: a.scientific_name,
      group_id: a.species_group_id,
    })),
    fryShares: fryShares.map((f) => ({
      id: f.id,
      recipient_name: f.recipient_name,
      recipient_club: f.recipient_club,
      share_date: f.share_date,
      notes: f.notes,
      species_common_name: f.common_name,
      species_scientific_name: f.scientific_name,
      group_id: f.species_group_id,
      is_external: Boolean(f.is_external),
    })),
  };
}

/**
 * Get a member's CARES registrations (species they've registered).
 * Used by the fry sharing dialog to populate the species dropdown.
 */
export async function getCaresRegistrations(memberId: number): Promise<Array<{
  group_id: number;
  common_name: string | null;
  scientific_name: string | null;
}>> {
  return query<{
    group_id: number;
    common_name: string | null;
    scientific_name: string | null;
  }>(
    `SELECT
      r.species_group_id AS group_id,
      ${anyNameSql("common", "r.species_group_id")} AS common_name,
      sng.canonical_genus || ' ' || sng.canonical_species_name AS scientific_name
    FROM cares_registration r
    ${speciesJoinSql("r.species_group_id", "sng")}
    WHERE r.member_id = ?
    ORDER BY common_name, scientific_name`,
    [memberId]
  );
}

/**
 * Record a fry share for a CARES-registered species.
 */
export async function createFryShare(
  memberId: number,
  speciesGroupId: number,
  recipientName: string,
  recipientMemberId: number | null,
  recipientClub: string | null,
  shareDate: string,
  notes: string | null
): Promise<number> {
  // Verify member has this species registered for CARES
  const registered = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM cares_registration
     WHERE member_id = ? AND species_group_id = ?`,
    [memberId, speciesGroupId]
  );

  if ((registered[0]?.cnt ?? 0) === 0) {
    throw new Error('You must have this species registered for CARES to record a fry share');
  }

  const stmt = await writeConn.prepare(`
    INSERT INTO cares_fry_share (member_id, species_group_id, recipient_name, recipient_member_id, recipient_club, share_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    const result = await stmt.run(
      memberId, speciesGroupId, recipientName,
      recipientMemberId, recipientClub, shareDate, notes
    );
    return result.lastID as number;
  } finally {
    await stmt.finalize();
  }
}

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
    ${speciesJoinSql("sc.group_id", "sng", { required: true })}
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
  return (await getMemberCaresCount(memberId)) > 0;
}

/**
 * Get count of CARES species a member has registered.
 */
export async function getMemberCaresCount(memberId: number): Promise<number> {
  const rows = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM cares_registration WHERE member_id = ?`,
    [memberId]
  );
  return rows[0]?.cnt ?? 0;
}

// Coverage of the CARES priority list across members' collections.

export type CaresCoverageStats = {
  total_cares_species: number;
  maintained_species: number;
  coverage_percent: number;
  most_maintained: Array<{
    group_id: number;
    canonical_genus: string;
    canonical_species_name: string;
    keeper_count: number;
  }>;
  unmaintained: Array<{
    group_id: number;
    canonical_genus: string;
    canonical_species_name: string;
  }>;
};

export async function getCaresCoverageStats(): Promise<CaresCoverageStats> {
  const totalRow = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM ${speciesFromSql("sng")} WHERE sng.is_cares_species = 1`
  );
  const total_cares_species = totalRow[0]?.count || 0;

  const maintainedRow = await query<{ count: number }>(
    `SELECT COUNT(DISTINCT sng.group_id) as count
     FROM ${speciesFromSql("sng")}
     JOIN species_collection c ON c.group_id = sng.group_id
       AND c.removed_date IS NULL AND c.visibility = 'public'
     WHERE sng.is_cares_species = 1`
  );
  const maintained_species = maintainedRow[0]?.count || 0;

  const most_maintained = await query<{
    group_id: number;
    canonical_genus: string;
    canonical_species_name: string;
    keeper_count: number;
  }>(
    `SELECT sng.group_id, sng.canonical_genus, sng.canonical_species_name,
            COUNT(DISTINCT c.member_id) as keeper_count
     FROM ${speciesFromSql("sng")}
     JOIN species_collection c ON c.group_id = sng.group_id
       AND c.removed_date IS NULL AND c.visibility = 'public'
     WHERE sng.is_cares_species = 1
     GROUP BY sng.group_id
     ORDER BY keeper_count DESC
     LIMIT 5`
  );

  const unmaintained = await query<{
    group_id: number;
    canonical_genus: string;
    canonical_species_name: string;
  }>(
    `SELECT sng.group_id, sng.canonical_genus, sng.canonical_species_name
     FROM ${speciesFromSql("sng")}
     WHERE sng.is_cares_species = 1
       AND NOT EXISTS (
         SELECT 1 FROM species_collection c
         WHERE c.group_id = sng.group_id
           AND c.removed_date IS NULL AND c.visibility = 'public'
       )
     ORDER BY sng.canonical_genus, sng.canonical_species_name
     LIMIT 10`
  );

  return {
    total_cares_species,
    maintained_species,
    coverage_percent: total_cares_species > 0
      ? Math.round((maintained_species / total_cares_species) * 100)
      : 0,
    most_maintained,
    unmaintained,
  };
}

export async function getCaresMaintenersForSpecies(
  groupId: number
): Promise<Array<{ id: number; display_name: string; cares_registered_at: string | null }>> {
  return query<{ id: number; display_name: string; cares_registered_at: string | null }>(
    `SELECT m.id, m.display_name, r.registered_at AS cares_registered_at
     FROM species_collection c
     JOIN members m ON c.member_id = m.id
     LEFT JOIN cares_registration r
       ON r.member_id = c.member_id AND r.species_group_id = c.group_id
     WHERE c.group_id = ? AND c.removed_date IS NULL AND c.visibility = 'public'
     ORDER BY r.registered_at DESC NULLS LAST, m.display_name`,
    [groupId]
  );
}
