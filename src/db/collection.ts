import { query, writeConn } from './conn';
import type { ImageMetadata } from '../utils/upload';

export interface CollectionEntry {
  id: number;
  member_id: number;
  group_id: number;
  quantity: number;
  acquired_date: string;
  removed_date: string | null;
  notes: string | null;
  images: ImageMetadata[] | null;
  visibility: 'public' | 'private';
  created_at: string;
  updated_at: string;
  // Joined data
  species?: {
    common_name: string;
    scientific_name: string;
    program_class: string;
    species_type: string;
    is_cares_species: boolean;
  };
  member?: {
    id: number;
    display_name: string;
  };
}

export interface CollectionStats {
  current: number;      // Currently kept species
  lifetime: number;     // Total species ever kept
  byClass: Record<string, number>; // Breakdown by program class
  byType: Record<string, number>;  // Breakdown by species type
}

export interface AddCollectionData {
  group_id: number;
  quantity?: number;
  acquired_date?: string;
  notes?: string;
  visibility?: 'public' | 'private';
}

export interface UpdateCollectionData {
  quantity?: number;
  notes?: string;
  visibility?: 'public' | 'private';
  removed_date?: string | null;
  images?: ImageMetadata[];
}

// Internal types for database queries
interface CollectionRow {
  id: number;
  member_id: number;
  group_id: number;
  quantity: number;
  acquired_date: string;
  removed_date: string | null;
  notes: string | null;
  images: string | null;
  visibility: 'public' | 'private';
  created_at: string;
  updated_at: string;
  // Joined fields
  scientific_name?: string;
  common_name?: string;
  program_class?: string;
  species_type?: string;
  is_cares_species?: number;
  member_display_name?: string;
}

interface StatsRow {
  current: number;
  lifetime: number;
}

interface CountRow {
  count: number;
}

interface ClassCountRow {
  program_class: string;
  count: number;
}

interface TypeCountRow {
  species_type: string;
  count: number;
}

/**
 * Get collection entries for a member
 */
export async function getCollectionForMember(
  memberId: number,
  options?: {
    includeRemoved?: boolean;
    includePrivate?: boolean;
    viewerId?: number | null;
  }
): Promise<CollectionEntry[]> {
  const { includeRemoved = false, includePrivate = false, viewerId = null } = options || {};

  let sql = `
    SELECT
      c.*,
      sng.canonical_species_name || ' ' || sng.canonical_genus AS scientific_name,
      (SELECT common_name FROM species_common_name
       WHERE group_id = c.group_id LIMIT 1) AS common_name,
      sng.program_class,
      sng.species_type,
      sng.is_cares_species,
      m.display_name AS member_display_name
    FROM species_collection c
    JOIN species_name_group sng ON c.group_id = sng.group_id
    JOIN members m ON c.member_id = m.id
    WHERE c.member_id = ?
  `;

  const params: (string | number)[] = [memberId];

  // Filter by removed status
  if (!includeRemoved) {
    sql += ' AND c.removed_date IS NULL';
  }

  // Filter by visibility
  if (!includePrivate && viewerId !== memberId) {
    sql += ' AND c.visibility = ?';
    params.push('public');
  }

  sql += ' ORDER BY c.acquired_date DESC, c.created_at DESC';

  const rows = await query<CollectionRow>(sql, params);

  return rows.map(row => ({
    ...row,
    images: row.images ? JSON.parse(row.images) as ImageMetadata[] : null,
    species: {
      common_name: row.common_name,
      scientific_name: row.scientific_name,
      program_class: row.program_class,
      species_type: row.species_type,
      is_cares_species: Boolean(row.is_cares_species)
    },
    member: {
      id: row.member_id,
      display_name: row.member_display_name
    }
  }));
}

/**
 * Add a species to a member's collection
 */
export async function addToCollection(
  memberId: number,
  data: AddCollectionData
): Promise<number> {
  // Check if species already exists in current collection
  const existing = await query<{ id: number }>(
    `SELECT id FROM species_collection
     WHERE member_id = ? AND group_id = ? AND removed_date IS NULL`,
    [memberId, data.group_id]
  );

  if (existing.length > 0) {
    throw new Error('Species already in collection. Please update the existing entry.');
  }

  const stmt = await writeConn.prepare(`
    INSERT INTO species_collection (
      member_id, group_id, quantity, acquired_date, notes, visibility
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  try {
    const info = await stmt.run(
      memberId,
      data.group_id,
      data.quantity || 1,
      data.acquired_date || new Date().toISOString().split('T')[0],
      data.notes || null,
      data.visibility || 'public'
    );

    return Number(info.lastID);
  } finally {
    await stmt.finalize();
  }
}

/**
 * Update a collection entry
 */
export async function updateCollectionEntry(
  id: number,
  memberId: number,
  updates: UpdateCollectionData
): Promise<void> {
  // Build dynamic update query
  const updateFields: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const params: (string | number | null)[] = [];

  if (updates.quantity !== undefined) {
    updateFields.push('quantity = ?');
    params.push(updates.quantity);
  }

  if (updates.notes !== undefined) {
    updateFields.push('notes = ?');
    params.push(updates.notes);
  }

  if (updates.visibility !== undefined) {
    updateFields.push('visibility = ?');
    params.push(updates.visibility);
  }

  if (updates.removed_date !== undefined) {
    updateFields.push('removed_date = ?');
    params.push(updates.removed_date);
  }

  if (updates.images !== undefined) {
    updateFields.push('images = ?');
    params.push(JSON.stringify(updates.images));
  }

  params.push(id, memberId); // For WHERE clause

  const stmt = await writeConn.prepare(`
    UPDATE species_collection
    SET ${updateFields.join(', ')}
    WHERE id = ? AND member_id = ?
  `);

  try {
    const info = await stmt.run(...params);
    if (info.changes === 0) {
      throw new Error('Collection entry not found or access denied');
    }
  } finally {
    await stmt.finalize();
  }
}

/**
 * Remove a species from collection (soft delete)
 */
export async function removeFromCollection(
  id: number,
  memberId: number
): Promise<void> {
  const stmt = await writeConn.prepare(`
    UPDATE species_collection
    SET removed_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND member_id = ? AND removed_date IS NULL
  `);

  try {
    const info = await stmt.run(id, memberId);
    if (info.changes === 0) {
      throw new Error('Collection entry not found, already removed, or access denied');
    }
  } finally {
    await stmt.finalize();
  }
}

/**
 * Get a single collection entry
 */
export async function getCollectionEntry(
  id: number,
  memberId?: number
): Promise<CollectionEntry | null> {
  let sql = `
    SELECT
      c.*,
      sng.canonical_species_name || ' ' || sng.canonical_genus AS scientific_name,
      (SELECT common_name FROM species_common_name
       WHERE group_id = c.group_id LIMIT 1) AS common_name,
      sng.program_class,
      sng.species_type,
      sng.is_cares_species,
      m.display_name AS member_display_name
    FROM species_collection c
    JOIN species_name_group sng ON c.group_id = sng.group_id
    JOIN members m ON c.member_id = m.id
    WHERE c.id = ?
  `;

  const params: (string | number)[] = [id];

  if (memberId) {
    sql += ' AND (c.member_id = ? OR c.visibility = ?)';
    params.push(memberId, 'public');
  } else {
    sql += ' AND c.visibility = ?';
    params.push('public');
  }

  const rows = await query<CollectionRow>(sql, params);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    ...row,
    images: row.images ? JSON.parse(row.images) as ImageMetadata[] : null,
    species: {
      common_name: row.common_name,
      scientific_name: row.scientific_name,
      program_class: row.program_class,
      species_type: row.species_type,
      is_cares_species: Boolean(row.is_cares_species)
    },
    member: {
      id: row.member_id,
      display_name: row.member_display_name
    }
  };
}

/**
 * Get collection statistics for a member
 */
export async function getCollectionStats(memberId: number): Promise<CollectionStats> {
  const stats = await query<StatsRow>(
    `SELECT
      COUNT(CASE WHEN removed_date IS NULL THEN 1 END) as current,
      COUNT(*) as lifetime
    FROM species_collection
    WHERE member_id = ?`,
    [memberId]
  );

  const byClass = await query<ClassCountRow>(
    `SELECT
      sng.program_class,
      COUNT(*) as count
    FROM species_collection c
    JOIN species_name_group sng ON c.group_id = sng.group_id
    WHERE c.member_id = ? AND c.removed_date IS NULL
    GROUP BY sng.program_class`,
    [memberId]
  );

  const byType = await query<TypeCountRow>(
    `SELECT
      sng.species_type,
      COUNT(*) as count
    FROM species_collection c
    JOIN species_name_group sng ON c.group_id = sng.group_id
    WHERE c.member_id = ? AND c.removed_date IS NULL
    GROUP BY sng.species_type`,
    [memberId]
  );

  return {
    current: stats[0]?.current || 0,
    lifetime: stats[0]?.lifetime || 0,
    byClass: Object.fromEntries(byClass.map(row => [row.program_class, row.count])),
    byType: Object.fromEntries(byType.map(row => [row.species_type, row.count]))
  };
}

/**
 * Get members who keep a specific species
 */
export async function getSpeciesKeepers(
  groupId: number,
  options?: { includePrivate?: boolean }
): Promise<{ count: number; members: Array<{ id: number; display_name: string; quantity: number }> }> {
  const { includePrivate = false } = options || {};

  let sql = `
    SELECT
      m.id,
      m.display_name,
      c.quantity
    FROM species_collection c
    JOIN members m ON c.member_id = m.id
    WHERE c.group_id = ? AND c.removed_date IS NULL
  `;

  const params: (string | number)[] = [groupId];

  if (!includePrivate) {
    sql += ' AND c.visibility = ?';
    params.push('public');
  }

  sql += ' ORDER BY m.display_name';

  const members = await query<{ id: number; display_name: string; quantity: number }>(sql, params);

  const countSql = `
    SELECT COUNT(DISTINCT member_id) as count
    FROM species_collection
    WHERE group_id = ? AND removed_date IS NULL ${!includePrivate ? 'AND visibility = ?' : ''}
  `;

  const countResult = await query<CountRow>(countSql, params);

  return {
    count: countResult[0]?.count || 0,
    members: members
  };
}

/**
 * Get recent collection additions for activity feed
 */
export async function getRecentCollectionAdditions(limit = 10): Promise<CollectionEntry[]> {
  const rows = await query<CollectionRow>(
    `SELECT
      c.*,
      sng.canonical_species_name || ' ' || sng.canonical_genus AS scientific_name,
      (SELECT common_name FROM species_common_name
       WHERE group_id = c.group_id LIMIT 1) AS common_name,
      sng.program_class,
      sng.species_type,
      sng.is_cares_species,
      m.display_name AS member_display_name
    FROM species_collection c
    JOIN species_name_group sng ON c.group_id = sng.group_id
    JOIN members m ON c.member_id = m.id
    WHERE c.visibility = 'public' AND c.removed_date IS NULL
    ORDER BY c.created_at DESC
    LIMIT ?`,
    [limit]
  );

  return rows.map(row => ({
    ...row,
    images: row.images ? JSON.parse(row.images) as ImageMetadata[] : null,
    species: {
      common_name: row.common_name,
      scientific_name: row.scientific_name,
      program_class: row.program_class,
      species_type: row.species_type,
      is_cares_species: Boolean(row.is_cares_species)
    },
    member: {
      id: row.member_id,
      display_name: row.member_display_name
    }
  }));
}

/**
 * Update collection images
 */
export async function updateCollectionImages(
  id: number,
  memberId: number,
  images: ImageMetadata[]
): Promise<void> {
  // Validate max 5 images
  if (images.length > 5) {
    throw new Error('Maximum 5 images allowed per collection entry');
  }

  await updateCollectionEntry(id, memberId, { images });
}