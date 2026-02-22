import { query, writeConn } from './conn';

export interface CaresRegistration {
  collection_id: number;
  group_id: number;
  common_name: string | null;
  scientific_name: string | null;
  cares_registered_at: string;
  cares_photo_key: string | null;
  cares_photo_url: string | null;
  cares_last_confirmed: string | null;
  images: string | null; // JSON array of ImageMetadata from species_collection
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
  collection_id: number;
  group_id: number;
  common_name: string | null;
  scientific_name: string | null;
  cares_registered_at: string;
  cares_photo_key: string | null;
  cares_photo_url: string | null;
  cares_last_confirmed: string | null;
  images: string | null;
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
 * Register a collection entry for the CARES program.
 * Sets cares_registered_at and stores the photo key/URL.
 */
export async function registerForCares(
  collectionEntryId: number,
  memberId: number,
  photoKey: string,
  photoUrl: string
): Promise<void> {
  // Verify the entry exists, belongs to this member, is a CARES-eligible species,
  // and is not already registered
  const entries = await query<{
    id: number;
    group_id: number | null;
    is_cares_species: number;
    cares_registered_at: string | null;
  }>(
    `SELECT c.id, c.group_id, sng.is_cares_species, c.cares_registered_at
     FROM species_collection c
     LEFT JOIN species_name_group sng ON c.group_id = sng.group_id
     WHERE c.id = ? AND c.member_id = ? AND c.removed_date IS NULL`,
    [collectionEntryId, memberId]
  );

  if (entries.length === 0) {
    throw new Error('Collection entry not found or access denied');
  }

  const entry = entries[0];

  if (!entry.group_id) {
    throw new Error('Only species linked to the database can be registered for CARES');
  }

  if (!entry.is_cares_species) {
    throw new Error('This species is not part of the CARES priority list');
  }

  if (entry.cares_registered_at) {
    throw new Error('This species is already registered for CARES');
  }

  const stmt = await writeConn.prepare(`
    UPDATE species_collection
    SET cares_registered_at = CURRENT_TIMESTAMP,
        cares_photo_key = ?,
        cares_photo_url = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND member_id = ?
  `);

  try {
    await stmt.run(photoKey, photoUrl, collectionEntryId, memberId);
  } finally {
    await stmt.finalize();
  }
}

/**
 * Update the CARES registration photo for a collection entry.
 */
export async function updateCaresPhoto(
  collectionEntryId: number,
  memberId: number,
  photoKey: string,
  photoUrl: string
): Promise<{ oldPhotoKey: string | null }> {
  // Get old photo key for cleanup
  const entries = await query<{
    cares_registered_at: string | null;
    cares_photo_key: string | null;
  }>(
    `SELECT cares_registered_at, cares_photo_key
     FROM species_collection
     WHERE id = ? AND member_id = ? AND removed_date IS NULL`,
    [collectionEntryId, memberId]
  );

  if (entries.length === 0) {
    throw new Error('Collection entry not found or access denied');
  }

  if (!entries[0].cares_registered_at) {
    throw new Error('This species is not registered for CARES');
  }

  const oldPhotoKey = entries[0].cares_photo_key;

  const stmt = await writeConn.prepare(`
    UPDATE species_collection
    SET cares_photo_key = ?,
        cares_photo_url = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND member_id = ?
  `);

  try {
    await stmt.run(photoKey, photoUrl, collectionEntryId, memberId);
  } finally {
    await stmt.finalize();
  }

  return { oldPhotoKey };
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
  const entries = await query<{
    is_cares_species: number;
    cares_registered_at: string | null;
    cares_photo_url: string | null;
  }>(
    `SELECT sng.is_cares_species, c.cares_registered_at, c.cares_photo_url
     FROM species_collection c
     LEFT JOIN species_name_group sng ON c.group_id = sng.group_id
     WHERE c.id = ? AND c.member_id = ? AND c.removed_date IS NULL`,
    [collectionEntryId, memberId]
  );

  if (entries.length === 0) return null;

  const entry = entries[0];
  return {
    eligible: Boolean(entry.is_cares_species),
    registered: Boolean(entry.cares_registered_at),
    photoUrl: entry.cares_photo_url,
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
      c.id AS collection_id,
      c.group_id,
      COALESCE(
        (SELECT common_name FROM species_common_name WHERE group_id = c.group_id LIMIT 1),
        c.common_name
      ) AS common_name,
      COALESCE(
        sng.canonical_genus || ' ' || sng.canonical_species_name,
        c.scientific_name
      ) AS scientific_name,
      c.cares_registered_at,
      c.cares_photo_key,
      c.cares_photo_url,
      c.cares_last_confirmed,
      c.images,
      CASE WHEN c.images IS NOT NULL AND c.images != '[]' THEN 1 ELSE 0 END AS has_photo,
      COALESCE((
        SELECT COUNT(*) FROM cares_article ca
        WHERE ca.member_id = c.member_id AND ca.species_group_id = c.group_id
      ), 0) AS article_count,
      COALESCE((
        SELECT COUNT(*) FROM cares_fry_share fs
        WHERE fs.member_id = c.member_id AND fs.species_group_id = c.group_id
          AND fs.recipient_member_id IS NOT NULL
      ), 0) AS internal_share_count,
      COALESCE((
        SELECT COUNT(*) FROM cares_fry_share fs
        WHERE fs.member_id = c.member_id AND fs.species_group_id = c.group_id
          AND fs.recipient_club IS NOT NULL AND fs.recipient_member_id IS NULL
      ), 0) AS external_share_count,
      CASE
        WHEN c.cares_last_confirmed IS NOT NULL
          AND julianday(c.cares_last_confirmed) - julianday(c.cares_registered_at) >= 730
        THEN 1
        ELSE 0
      END AS years_confirmed
    FROM species_collection c
    LEFT JOIN species_name_group sng ON c.group_id = sng.group_id
    WHERE c.member_id = ?
      AND c.cares_registered_at IS NOT NULL
      AND c.removed_date IS NULL
    ORDER BY c.cares_registered_at DESC`,
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
        (SELECT common_name FROM species_common_name WHERE group_id = ca.species_group_id LIMIT 1),
        NULL
      ) AS common_name,
      COALESCE(
        sng.canonical_genus || ' ' || sng.canonical_species_name,
        NULL
      ) AS scientific_name,
      ca.species_group_id
    FROM cares_article ca
    LEFT JOIN species_name_group sng ON ca.species_group_id = sng.group_id
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
        (SELECT common_name FROM species_common_name WHERE group_id = fs.species_group_id LIMIT 1),
        NULL
      ) AS common_name,
      COALESCE(
        sng.canonical_genus || ' ' || sng.canonical_species_name,
        NULL
      ) AS scientific_name,
      fs.species_group_id,
      CASE WHEN fs.recipient_member_id IS NULL AND fs.recipient_club IS NOT NULL THEN 1 ELSE 0 END AS is_external
    FROM cares_fry_share fs
    LEFT JOIN species_name_group sng ON fs.species_group_id = sng.group_id
    WHERE fs.member_id = ?
    ORDER BY fs.share_date DESC, fs.created_at DESC`,
    [memberId]
  );

  return {
    registrations: registrations.map((r) => ({
      collection_id: r.collection_id,
      group_id: r.group_id,
      common_name: r.common_name,
      scientific_name: r.scientific_name,
      cares_registered_at: r.cares_registered_at,
      cares_photo_key: r.cares_photo_key,
      cares_photo_url: r.cares_photo_url,
      cares_last_confirmed: r.cares_last_confirmed,
      images: r.images,
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
