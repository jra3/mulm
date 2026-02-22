import { query, writeConn } from './conn';

export interface CaresRegistration {
  id: number;
  member_id: number;
  group_id: number;
  common_name: string | null;
  scientific_name: string | null;
  cares_registered_at: string;
  cares_photo_key: string | null;
  cares_photo_url: string | null;
  cares_last_confirmed: string | null;
}

interface CaresRegistrationRow {
  id: number;
  member_id: number;
  group_id: number;
  cares_registered_at: string;
  cares_photo_key: string | null;
  cares_photo_url: string | null;
  cares_last_confirmed: string | null;
  canonical_common_name: string | null;
  canonical_scientific_name: string | null;
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
 * Get all CARES registrations for a member.
 */
export async function getCaresRegistrations(
  memberId: number
): Promise<CaresRegistration[]> {
  const rows = await query<CaresRegistrationRow>(
    `SELECT
      c.id,
      c.member_id,
      c.group_id,
      c.cares_registered_at,
      c.cares_photo_key,
      c.cares_photo_url,
      c.cares_last_confirmed,
      (SELECT common_name FROM species_common_name
       WHERE group_id = c.group_id LIMIT 1) AS canonical_common_name,
      sng.canonical_genus || ' ' || sng.canonical_species_name AS canonical_scientific_name
    FROM species_collection c
    JOIN species_name_group sng ON c.group_id = sng.group_id
    WHERE c.member_id = ?
      AND c.cares_registered_at IS NOT NULL
      AND c.removed_date IS NULL
    ORDER BY c.cares_registered_at DESC`,
    [memberId]
  );

  return rows.map(row => ({
    id: row.id,
    member_id: row.member_id,
    group_id: row.group_id,
    common_name: row.canonical_common_name,
    scientific_name: row.canonical_scientific_name,
    cares_registered_at: row.cares_registered_at,
    cares_photo_key: row.cares_photo_key,
    cares_photo_url: row.cares_photo_url,
    cares_last_confirmed: row.cares_last_confirmed,
  }));
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
