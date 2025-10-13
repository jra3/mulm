import { query, writeConn, withTransaction } from "./conn";
import { logger } from "@/utils/logger";

type NameSynonym = {
	/** Not a phylogenetic class. The species class for the BAP program */
	program_class: string;
	canonical_genus: string;
	canonical_species_name: string;
	common_name: string;
	/** Typically a simple combination of genus and species */
	latin_name: string;
}

export async function querySpeciesNames() {
  // Query split schema tables and create paired records
  const groups = await query<{
    group_id: number;
    program_class: string;
    canonical_genus: string;
    canonical_species_name: string;
  }>('SELECT group_id, program_class, canonical_genus, canonical_species_name FROM species_name_group');

  const results: NameSynonym[] = [];

  for (const group of groups) {
    const [commonNames, scientificNames] = await Promise.all([
      query<{ common_name: string }>('SELECT common_name FROM species_common_name WHERE group_id = ? ORDER BY common_name', [group.group_id]),
      query<{ scientific_name: string }>('SELECT scientific_name FROM species_scientific_name WHERE group_id = ? ORDER BY scientific_name', [group.group_id])
    ]);

    // Pair common names with scientific names
    const maxLength = Math.max(commonNames.length, scientificNames.length);
    for (let i = 0; i < maxLength; i++) {
      results.push({
        program_class: group.program_class,
        canonical_genus: group.canonical_genus,
        canonical_species_name: group.canonical_species_name,
        common_name: commonNames[i]?.common_name || commonNames[0]?.common_name || '',
        latin_name: scientificNames[i]?.scientific_name || scientificNames[0]?.scientific_name || ''
      });
    }
  }

  return results;
}

export async function recordName(data: NameSynonym): Promise<{
  group_id: number;
  common_name_id: number;
  scientific_name_id: number;
}> {
  try {
    return await withTransaction(async (db) => {
      const groupStmt = await db.prepare(`
				INSERT INTO species_name_group(
					program_class,
					canonical_genus,
					canonical_species_name
				) VALUES (?, ?, ?)
				ON CONFLICT(canonical_genus, canonical_species_name)
				DO UPDATE SET group_id = group_id
				RETURNING group_id;
			`);

      const result = await groupStmt.get<{ group_id: number }>(
        data.program_class,
        data.canonical_genus,
        data.canonical_species_name
      );
      await groupStmt.finalize();

      if (!result || !result.group_id) {
        throw new Error("Failed to insert or update species name group");
      }
      const group_id = result.group_id;

      // Insert common name and get ID
      const commonNameStmt = await db.prepare(`
				INSERT INTO species_common_name(group_id, common_name)
				VALUES (?, ?)
				ON CONFLICT(group_id, common_name)
				DO UPDATE SET common_name = common_name
				RETURNING common_name_id;
			`);
      const commonResult = await commonNameStmt.get<{ common_name_id: number }>(group_id, data.common_name);
      await commonNameStmt.finalize();

      if (!commonResult || !commonResult.common_name_id) {
        throw new Error("Failed to insert common name");
      }

      // Insert scientific name and get ID
      const scientificNameStmt = await db.prepare(`
				INSERT INTO species_scientific_name(group_id, scientific_name)
				VALUES (?, ?)
				ON CONFLICT(group_id, scientific_name)
				DO UPDATE SET scientific_name = scientific_name
				RETURNING scientific_name_id;
			`);
      const scientificResult = await scientificNameStmt.get<{ scientific_name_id: number }>(group_id, data.latin_name);
      await scientificNameStmt.finalize();

      if (!scientificResult || !scientificResult.scientific_name_id) {
        throw new Error("Failed to insert scientific name");
      }

      return {
        group_id,
        common_name_id: commonResult.common_name_id,
        scientific_name_id: scientificResult.scientific_name_id
      };
    });
  } catch (err) {
    logger.error('Failed to record species name', err);
    throw new Error("Failed to record species name");
  }
}

export async function mergeSpecies(canonicalGroupId: number, defunctGroupId: number): Promise<void> {
  try {
    await withTransaction(async (db) => {
      // Update common names to point to the canonical group
      const updateCommonStmt = await db.prepare(`
				UPDATE species_common_name
				SET group_id = ?
				WHERE group_id = ?
			`);
      await updateCommonStmt.run(canonicalGroupId, defunctGroupId);
      await updateCommonStmt.finalize();

      // Update scientific names to point to the canonical group
      const updateScientificStmt = await db.prepare(`
				UPDATE species_scientific_name
				SET group_id = ?
				WHERE group_id = ?
			`);
      await updateScientificStmt.run(canonicalGroupId, defunctGroupId);
      await updateScientificStmt.finalize();

      // Delete the defunct species group
      const deleteStmt = await db.prepare(`
				DELETE FROM species_name_group
				WHERE group_id = ?
			`);
      await deleteStmt.run(defunctGroupId);
      await deleteStmt.finalize();
    });
  } catch (err) {
    logger.error('Failed to merge species groups', err);
    throw new Error("Failed to merge species groups");
  }
}

/**
 * Get species group data directly by group_id
 * @param groupId - Species group ID
 * @returns Species group data or undefined if not found
 */
export async function getSpeciesGroup(groupId: number) {
  const rows = await query<{
		group_id: number;
		program_class: string;
		species_type: string;
		canonical_genus: string;
		canonical_species_name: string;
		base_points: number | null;
		is_cares_species: number;
		external_references: string | null;
		image_links: string | null;
	}>(`
		SELECT * FROM species_name_group WHERE group_id = ?`,
	[groupId]
	);

  return rows.pop();
}

/**
 * Get species group_id from a common_name_id or scientific_name_id
 * @param nameId - Either a common_name_id or scientific_name_id
 * @param isCommonName - If true, treats nameId as common_name_id; if false, as scientific_name_id
 * @returns group_id or undefined if not found
 */
export async function getGroupIdFromNameId(nameId: number, isCommonName: boolean): Promise<number | undefined> {
  if (isCommonName) {
    const rows = await query<{ group_id: number }>(
      'SELECT group_id FROM species_common_name WHERE common_name_id = ?',
      [nameId]
    );
    return rows.pop()?.group_id;
  } else {
    const rows = await query<{ group_id: number }>(
      'SELECT group_id FROM species_scientific_name WHERE scientific_name_id = ?',
      [nameId]
    );
    return rows.pop()?.group_id;
  }
}

/**
 * DEPRECATED: Get canonical species group data from a legacy name ID
 *
 * **This function is deprecated and will be removed.** Use getSpeciesGroup(groupId) instead.
 * For submissions, get group_id from common_name_id or scientific_name_id first.
 *
 * @param speciesNameId - Legacy name_id from species_name table
 * @returns Species group data or undefined if not found
 */
export async function getCanonicalSpeciesName(speciesNameId: number) {
  // Try legacy table first (if it exists) to avoid ID collisions
  // After migration 030, this will fail gracefully and fall through to new tables
  try {
    const legacyRows = await query<{
      group_id: number;
      program_class: string;
      species_type: string;
      canonical_genus: string;
      canonical_species_name: string;
      base_points: number | null;
      is_cares_species: number;
      external_references: string | null;
      image_links: string | null;
    }>(`
      SELECT species_name_group.*
      FROM species_name JOIN species_name_group
      ON species_name.group_id = species_name_group.group_id
      WHERE species_name.name_id = ?`,
    [speciesNameId]
    );

    if (legacyRows.length > 0) {
      return legacyRows[0];
    }
  } catch {
    // Table doesn't exist (post-migration 030) - fall through to new schema
  }

  // Try new common name table
  const commonNameRows = await query<{
		group_id: number;
		program_class: string;
		species_type: string;
		canonical_genus: string;
		canonical_species_name: string;
		base_points: number | null;
		is_cares_species: number;
		external_references: string | null;
		image_links: string | null;
	}>(`
		SELECT species_name_group.*
		FROM species_common_name cn
		JOIN species_name_group ON cn.group_id = species_name_group.group_id
		WHERE cn.common_name_id = ?`,
	[speciesNameId]
	);

  if (commonNameRows.length > 0) {
    return commonNameRows[0];
  }

  // Try new scientific name table
  const scientificNameRows = await query<{
		group_id: number;
		program_class: string;
		species_type: string;
		canonical_genus: string;
		canonical_species_name: string;
		base_points: number | null;
		is_cares_species: number;
		external_references: string | null;
		image_links: string | null;
	}>(`
		SELECT species_name_group.*
		FROM species_scientific_name sn
		JOIN species_name_group ON sn.group_id = species_name_group.group_id
		WHERE sn.scientific_name_id = ?`,
	[speciesNameId]
	);

  return scientificNameRows.pop();
}

export type SpeciesFilters = {
	species_type?: string;
	species_class?: string;
	search?: string;
	sort?: 'name' | 'reports' | 'breeders';
};

export type SpeciesExplorerItem = {
	group_id: number;
	program_class: string;
	canonical_genus: string;
	canonical_species_name: string;
	total_breeds: number;
	total_breeders: number;
	common_names: string;
	scientific_names: string;
	latest_breed_date: string | null;
};

/**
 * Individual species name record for typeahead/autocomplete
 * Represents a single name variant (synonym) for a species
 */
export type SpeciesNameRecord = {
	name_id: number;
	group_id: number;
	common_name: string;
	scientific_name: string;
	program_class: string;
	canonical_genus: string;
	canonical_species_name: string;
};

/**
 * Unified species search function with flexible options
 * Handles both typeahead and explorer use cases
 */
function buildSpeciesSearchQuery(
  search?: string,
  species_type?: string,
  species_class?: string,
  sort: 'name' | 'reports' | 'breeders' = 'reports',
  limit?: number
): { sql: string; params: unknown[] } {
  // Build ORDER BY clause
  let orderBy = 'total_breeds DESC, total_breeders DESC';
  if (sort === 'name') {
    orderBy = 'sng.canonical_genus, sng.canonical_species_name';
  } else if (sort === 'breeders') {
    orderBy = 'total_breeders DESC, total_breeds DESC';
  }

  // Build WHERE conditions and parameters
  const conditions: string[] = ['1=1'];
  const params: unknown[] = [];

  if (species_type) {
    conditions.push('AND s.species_type = ?');
    params.push(species_type);
  }

  if (species_class) {
    conditions.push('AND s.species_class = ?');
    params.push(species_class);
  }

  if (search && search.trim().length >= 2) {
    const searchPattern = `%${search.trim().toLowerCase()}%`;
    conditions.push(`AND (
			LOWER(cn.common_name) LIKE ? OR
			LOWER(scin.scientific_name) LIKE ?
		)`);
    params.push(searchPattern, searchPattern);
  }

  const sql = `
		SELECT
			sng.group_id,
			sng.program_class,
			sng.canonical_genus,
			sng.canonical_species_name,
			COALESCE(COUNT(DISTINCT s.id), 0) as total_breeds,
			COALESCE(COUNT(DISTINCT s.member_id), 0) as total_breeders,
			COALESCE(GROUP_CONCAT(DISTINCT cn.common_name), '') as common_names,
			COALESCE(GROUP_CONCAT(DISTINCT scin.scientific_name), '') as scientific_names,
			MAX(s.approved_on) as latest_breed_date
		FROM species_name_group sng
		LEFT JOIN species_common_name cn ON sng.group_id = cn.group_id
		LEFT JOIN species_scientific_name scin ON sng.group_id = scin.group_id
		LEFT JOIN submissions s ON (s.common_name_id = cn.common_name_id OR s.scientific_name_id = scin.scientific_name_id) AND s.approved_on IS NOT NULL
		WHERE ${conditions.join(' ')}
		GROUP BY sng.group_id, sng.program_class, sng.canonical_genus, sng.canonical_species_name
		HAVING total_breeds > 0
		ORDER BY ${orderBy}
		${limit ? 'LIMIT ?' : ''}
	`;

  if (limit) {
    params.push(limit);
  }

  return { sql, params };
}

/**
 * Search species names for typeahead/autocomplete using split schema
 * Returns individual name records (not grouped) matching either common or scientific names
 *
 * **Migration Note**: Updated to query species_common_name and species_scientific_name tables
 * separately via UNION. Each result includes matched name and group metadata.
 *
 * @param searchQuery - Search term (minimum 2 characters)
 * @param filters - Optional filters for species_type and species_class
 * @param limit - Maximum number of results (default: 10)
 * @returns Array of species name records with group metadata
 */
export async function searchSpeciesTypeahead(
  searchQuery: string,
  filters: Omit<SpeciesFilters, 'search' | 'sort'> = {},
  limit: number = 10
): Promise<SpeciesNameRecord[]> {
  if (!searchQuery || searchQuery.trim().length < 2) {
    return [];
  }

  const searchPattern = `%${searchQuery.trim().toLowerCase()}%`;
  const conditions: string[] = ['1=1'];
  const params: unknown[] = [];

  if (filters.species_type) {
    conditions.push('AND sng.species_type = ?');
    params.push(filters.species_type);
  }

  if (filters.species_class) {
    conditions.push('AND sng.program_class = ?');
    params.push(filters.species_class);
  }

  // Build WHERE clause for both queries
  const whereClause = conditions.join(' ');

  // UNION query: search both common names and scientific names
  // Each subquery joins with species_name_group for metadata
  const sql = `
    SELECT
      cn.common_name_id as name_id,
      cn.group_id,
      cn.common_name,
      '' as scientific_name,
      sng.program_class,
      sng.species_type,
      sng.canonical_genus,
      sng.canonical_species_name,
      1 as is_common_name
    FROM species_common_name cn
    JOIN species_name_group sng ON cn.group_id = sng.group_id
    WHERE ${whereClause} AND LOWER(cn.common_name) LIKE ?

    UNION ALL

    SELECT
      sn.scientific_name_id as name_id,
      sn.group_id,
      '' as common_name,
      sn.scientific_name,
      sng.program_class,
      sng.species_type,
      sng.canonical_genus,
      sng.canonical_species_name,
      0 as is_common_name
    FROM species_scientific_name sn
    JOIN species_name_group sng ON sn.group_id = sng.group_id
    WHERE ${whereClause} AND LOWER(sn.scientific_name) LIKE ?

    ORDER BY is_common_name DESC, common_name, scientific_name
    LIMIT ?
  `;

  // Build params array: conditions params twice (for each subquery) + search pattern twice + limit
  const queryParams = [...params, searchPattern, ...params, searchPattern, limit];

  return query(sql, queryParams);
}

export async function getSpeciesForExplorer(filters: SpeciesFilters = {}): Promise<SpeciesExplorerItem[]> {
  const { species_type, species_class, search, sort = 'reports' } = filters;

  const { sql, params } = buildSpeciesSearchQuery(
    search,
    species_type,
    species_class,
    sort
    // No limit for explorer - return all results
  );

  return query<SpeciesExplorerItem>(sql, params);
}

export type SpeciesDetail = {
	group_id: number;
	program_class: string;
	species_type: string;
	canonical_genus: string;
	canonical_species_name: string;
	base_points: number | null;
	is_cares_species: number;
	external_references: string | null;
	image_links: string | null;
	synonyms: Array<{
		name_id: number;
		common_name: string;
		scientific_name: string;
	}>;
};

export async function getSpeciesDetail(groupId: number) {
  const groupRows = await query<{
		group_id: number;
		program_class: string;
		species_type: string;
		canonical_genus: string;
		canonical_species_name: string;
		base_points: number | null;
		is_cares_species: number;
		external_references: string | null;
		image_links: string | null;
	}>(`
		SELECT group_id, program_class, species_type, canonical_genus, canonical_species_name, base_points, is_cares_species, external_references, image_links
		FROM species_name_group
		WHERE group_id = ?
	`, [groupId]);

  if (groupRows.length === 0) {
    return null;
  }

  // Get all names from split schema tables
  const [commonNames, scientificNames] = await Promise.all([
    query<{ common_name_id: number; common_name: string }>(
      'SELECT common_name_id, common_name FROM species_common_name WHERE group_id = ? ORDER BY common_name',
      [groupId]
    ),
    query<{ scientific_name_id: number; scientific_name: string }>(
      'SELECT scientific_name_id, scientific_name FROM species_scientific_name WHERE group_id = ? ORDER BY scientific_name',
      [groupId]
    )
  ]);

  // Create paired synonyms for backward compatibility with existing views
  // Each common name is paired with the first scientific name
  const synonymRows = commonNames.map((cn, idx) => ({
    name_id: cn.common_name_id,
    common_name: cn.common_name,
    scientific_name: scientificNames[idx]?.scientific_name || scientificNames[0]?.scientific_name || ''
  }));

  const detail: SpeciesDetail = {
    ...groupRows[0],
    synonyms: synonymRows
  };

  return detail;
}

export type SpeciesBreeder = {
	member_id: number;
	member_name: string;
	breed_count: number;
	first_breed_date: string;
	latest_breed_date: string;
	submissions_concat?: string;
	submissions: Array<{
		id: number;
		species_common_name: string;
		species_latin_name: string;
		approved_on: string;
		points: number;
	}>;
};

/**
 * Get breeders who have bred a specific species
 *
 * @param groupId - Species group ID
 * @returns Array of breeders with their breeding statistics for this species
 */
export async function getBreedersForSpecies(groupId: number) {
  return query<SpeciesBreeder>(`
		SELECT
			m.id as member_id,
			m.display_name as member_name,
			COUNT(s.id) as breed_count,
			MIN(s.approved_on) as first_breed_date,
			MAX(s.approved_on) as latest_breed_date,
			GROUP_CONCAT(
				s.id || '|' ||
				s.species_common_name || '|' ||
				s.species_latin_name || '|' ||
				s.approved_on || '|' ||
				COALESCE(s.points, 0)
			) as submissions_concat
		FROM members m
		JOIN submissions s ON m.id = s.member_id
		LEFT JOIN species_common_name cn ON s.common_name_id = cn.common_name_id
		LEFT JOIN species_scientific_name scin ON s.scientific_name_id = scin.scientific_name_id
		WHERE (cn.group_id = ? OR scin.group_id = ?)
		  AND s.approved_on IS NOT NULL
		GROUP BY m.id, m.display_name
		ORDER BY breed_count DESC, latest_breed_date DESC
	`, [groupId, groupId]).then(rows => {
    return rows.map(row => ({
      ...row,
      submissions: row.submissions_concat ? row.submissions_concat.split(',').map((sub: string) => {
        const [id, common_name, latin_name, approved_on, points] = sub.split('|');
        return {
          id: parseInt(id),
          species_common_name: common_name,
          species_latin_name: latin_name,
          approved_on,
          points: parseInt(points)
        };
      }) : []
    }));
  });
}



export async function getFilterOptions() {
  const speciesTypes = await query<{ species_type: string }>(`
		SELECT DISTINCT species_type
		FROM submissions
		WHERE approved_on IS NOT NULL
		ORDER BY species_type
	`);

  return {
    species_types: speciesTypes.map(s => s.species_type)
  };
}

/**
 * Admin synonym management functions - NEW SPLIT SCHEMA
 */

export type CommonName = {
  common_name_id: number;
  group_id: number;
  common_name: string;
};

export type ScientificName = {
  scientific_name_id: number;
  group_id: number;
  scientific_name: string;
};

export type SpeciesNames = {
  common_names: CommonName[];
  scientific_names: ScientificName[];
};

// DEPRECATED: Old paired synonym type (for backwards compatibility)
export type SpeciesSynonym = {
  name_id: number;
  group_id: number;
  common_name: string;
  scientific_name: string;
};

/**
 * Get all common names for a species group
 * @param groupId - Species group ID
 * @returns Array of common names ordered alphabetically
 */
export async function getCommonNamesForGroup(groupId: number): Promise<CommonName[]> {
  return query<CommonName>(`
    SELECT common_name_id, group_id, common_name
    FROM species_common_name
    WHERE group_id = ?
    ORDER BY common_name
  `, [groupId]);
}

/**
 * Get all scientific names for a species group
 * @param groupId - Species group ID
 * @returns Array of scientific names ordered alphabetically
 */
export async function getScientificNamesForGroup(groupId: number): Promise<ScientificName[]> {
  return query<ScientificName>(`
    SELECT scientific_name_id, group_id, scientific_name
    FROM species_scientific_name
    WHERE group_id = ?
    ORDER BY scientific_name
  `, [groupId]);
}

/**
 * Get all names (both common and scientific) for a species group
 * @param groupId - Species group ID
 * @returns Object with arrays of common and scientific names
 */
export async function getNamesForGroup(groupId: number): Promise<SpeciesNames> {
  const [common_names, scientific_names] = await Promise.all([
    getCommonNamesForGroup(groupId),
    getScientificNamesForGroup(groupId)
  ]);

  return {
    common_names,
    scientific_names
  };
}

/**
 * DEPRECATED: Get synonyms from old paired table (for backwards compatibility)
 * Use getNamesForGroup() for new code
 *
 * After migration 030, returns empty array since species_name table no longer exists
 */
export async function getSynonymsForGroup(groupId: number): Promise<SpeciesSynonym[]> {
  try {
    return await query<SpeciesSynonym>(`
      SELECT name_id, group_id, common_name, scientific_name
      FROM species_name
      WHERE group_id = ?
      ORDER BY common_name, scientific_name
    `, [groupId]);
  } catch {
    // Table doesn't exist (post-migration 030)
    return [];
  }
}

/**
 * Add a common name to a species group
 * @param groupId - Species group ID
 * @param commonName - Common name to add
 * @returns The common_name_id of the newly created name
 * @throws Error if inputs are invalid, species group doesn't exist, or duplicate name
 */
export async function addCommonName(groupId: number, commonName: string): Promise<number> {
  const trimmed = commonName.trim();

  if (!trimmed) {
    throw new Error('Common name cannot be empty');
  }

  // Verify species group exists
  const groups = await query<{ group_id: number }>(
    'SELECT group_id FROM species_name_group WHERE group_id = ?',
    [groupId]
  );

  if (groups.length === 0) {
    throw new Error(`Species group ${groupId} not found`);
  }

  try {
    const conn = writeConn;
    const stmt = await conn.prepare(`
      INSERT INTO species_common_name (group_id, common_name)
      VALUES (?, ?)
      RETURNING common_name_id
    `);

    try {
      const result = await stmt.get<{ common_name_id: number }>(groupId, trimmed);

      if (!result || !result.common_name_id) {
        throw new Error('Failed to insert common name');
      }

      return result.common_name_id;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      throw new Error(`Common name "${trimmed}" already exists for this species`);
    }
    logger.error('Failed to add common name', err);
    throw new Error('Failed to add common name');
  }
}

/**
 * Add a scientific name to a species group
 * @param groupId - Species group ID
 * @param scientificName - Scientific name to add
 * @returns The scientific_name_id of the newly created name
 * @throws Error if inputs are invalid, species group doesn't exist, or duplicate name
 */
export async function addScientificName(groupId: number, scientificName: string): Promise<number> {
  const trimmed = scientificName.trim();

  if (!trimmed) {
    throw new Error('Scientific name cannot be empty');
  }

  // Verify species group exists
  const groups = await query<{ group_id: number }>(
    'SELECT group_id FROM species_name_group WHERE group_id = ?',
    [groupId]
  );

  if (groups.length === 0) {
    throw new Error(`Species group ${groupId} not found`);
  }

  try {
    const conn = writeConn;
    const stmt = await conn.prepare(`
      INSERT INTO species_scientific_name (group_id, scientific_name)
      VALUES (?, ?)
      RETURNING scientific_name_id
    `);

    try {
      const result = await stmt.get<{ scientific_name_id: number }>(groupId, trimmed);

      if (!result || !result.scientific_name_id) {
        throw new Error('Failed to insert scientific name');
      }

      return result.scientific_name_id;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      throw new Error(`Scientific name "${trimmed}" already exists for this species`);
    }
    logger.error('Failed to add scientific name', err);
    throw new Error('Failed to add scientific name');
  }
}

/**
 * Update a common name
 * @param commonNameId - Common name ID to update
 * @param newName - New common name value
 * @returns Number of rows updated (0 if not found, 1 if successful)
 * @throws Error if empty name or duplicate
 */
export async function updateCommonName(commonNameId: number, newName: string): Promise<number> {
  const trimmed = newName.trim();

  if (!trimmed) {
    throw new Error('Common name cannot be empty');
  }

  try {
    const conn = writeConn;
    const stmt = await conn.prepare(`
      UPDATE species_common_name
      SET common_name = ?
      WHERE common_name_id = ?
    `);

    try {
      const result = await stmt.run(trimmed, commonNameId);
      return result.changes || 0;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      throw new Error('This common name already exists for this species');
    }
    logger.error('Failed to update common name', err);
    throw new Error('Failed to update common name');
  }
}

/**
 * Update a scientific name
 * @param scientificNameId - Scientific name ID to update
 * @param newName - New scientific name value
 * @returns Number of rows updated (0 if not found, 1 if successful)
 * @throws Error if empty name or duplicate
 */
export async function updateScientificName(scientificNameId: number, newName: string): Promise<number> {
  const trimmed = newName.trim();

  if (!trimmed) {
    throw new Error('Scientific name cannot be empty');
  }

  try {
    const conn = writeConn;
    const stmt = await conn.prepare(`
      UPDATE species_scientific_name
      SET scientific_name = ?
      WHERE scientific_name_id = ?
    `);

    try {
      const result = await stmt.run(trimmed, scientificNameId);
      return result.changes || 0;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      throw new Error('This scientific name already exists for this species');
    }
    logger.error('Failed to update scientific name', err);
    throw new Error('Failed to update scientific name');
  }
}

/**
 * Delete a common name
 * @param commonNameId - Common name ID to delete
 * @returns Number of rows deleted (0 if not found, 1 if successful)
 */
export async function deleteCommonName(commonNameId: number): Promise<number> {
  try {
    const conn = writeConn;
    const stmt = await conn.prepare('DELETE FROM species_common_name WHERE common_name_id = ?');

    try {
      const result = await stmt.run(commonNameId);
      return result.changes || 0;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    logger.error('Failed to delete common name', err);
    throw new Error('Failed to delete common name');
  }
}

/**
 * Delete a scientific name
 * @param scientificNameId - Scientific name ID to delete
 * @returns Number of rows deleted (0 if not found, 1 if successful)
 */
export async function deleteScientificName(scientificNameId: number): Promise<number> {
  try {
    const conn = writeConn;
    const stmt = await conn.prepare('DELETE FROM species_scientific_name WHERE scientific_name_id = ?');

    try {
      const result = await stmt.run(scientificNameId);
      return result.changes || 0;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    logger.error('Failed to delete scientific name', err);
    throw new Error('Failed to delete scientific name');
  }
}

/**
 * DEPRECATED: Add a paired synonym to old table (for backwards compatibility)
 * Use addCommonName() and addScientificName() separately for new code
 *
 * After migration 030, throws error since species_name table no longer exists
 */
export async function addSynonym(
  groupId: number,
  commonName: string,
  scientificName: string
): Promise<number> {
  // Validate inputs
  const trimmedCommon = commonName.trim();
  const trimmedScientific = scientificName.trim();

  if (!trimmedCommon || !trimmedScientific) {
    throw new Error('Common name and scientific name cannot be empty');
  }

  // Verify species group exists
  const groups = await query<{ group_id: number }>(
    'SELECT group_id FROM species_name_group WHERE group_id = ?',
    [groupId]
  );

  if (groups.length === 0) {
    throw new Error(`Species group ${groupId} not found`);
  }

  try {
    const conn = writeConn;
    const stmt = await conn.prepare(`
      INSERT INTO species_name (group_id, common_name, scientific_name)
      VALUES (?, ?, ?)
      RETURNING name_id
    `);

    try {
      const result = await stmt.get<{ name_id: number }>(
        groupId,
        trimmedCommon,
        trimmedScientific
      );

      if (!result || !result.name_id) {
        throw new Error('Failed to insert synonym');
      }

      return result.name_id;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    // Check for duplicate constraint error
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      throw new Error(`Synonym "${trimmedCommon} (${trimmedScientific})" already exists`);
    }
    // After migration 030, table won't exist
    if (err instanceof Error && (err.message.includes('no such table') || err.message.includes('SQLITE_ERROR'))) {
      throw new Error('Legacy species_name table has been removed. Use addCommonName() and addScientificName() instead.');
    }
    logger.error('Failed to add synonym', err);
    throw new Error('Failed to add synonym');
  }
}

/**
 * Update an existing name variant (synonym)
 * @param nameId - Name variant ID
 * @param updates - Fields to update (at least one required)
 * @returns Number of rows updated (0 if not found, 1 if successful)
 * @throws Error if no fields provided, empty values, or duplicate name
 */
export async function updateSynonym(
  nameId: number,
  updates: {
    commonName?: string;
    scientificName?: string;
  }
): Promise<number> {
  const { commonName, scientificName } = updates;

  // At least one field must be provided
  if (commonName === undefined && scientificName === undefined) {
    throw new Error('At least one field (commonName or scientificName) must be provided');
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (commonName !== undefined) {
    const trimmed = commonName.trim();
    if (!trimmed) {
      throw new Error('Common name cannot be empty');
    }
    fields.push('common_name = ?');
    values.push(trimmed);
  }

  if (scientificName !== undefined) {
    const trimmed = scientificName.trim();
    if (!trimmed) {
      throw new Error('Scientific name cannot be empty');
    }
    fields.push('scientific_name = ?');
    values.push(trimmed);
  }

  values.push(nameId);

  try {
    const conn = writeConn;
    const stmt = await conn.prepare(`
      UPDATE species_name
      SET ${fields.join(', ')}
      WHERE name_id = ?
    `);

    try {
      const result = await stmt.run(...values);
      return result.changes || 0;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      throw new Error('This name combination already exists');
    }
    logger.error('Failed to update synonym', err);
    throw new Error('Failed to update synonym');
  }
}

/**
 * Delete a name variant (synonym) from a species group
 * @param nameId - Name variant ID to delete
 * @param force - If true, allows deleting the last synonym for a species (default: false)
 * @returns Number of rows deleted (0 if not found, 1 if successful)
 * @throws Error if trying to delete last synonym without force flag
 */
export async function deleteSynonym(nameId: number, force = false): Promise<number> {
  // Get the synonym to check its group
  const synonyms = await query<{ group_id: number; common_name: string; scientific_name: string }>(
    'SELECT group_id, common_name, scientific_name FROM species_name WHERE name_id = ?',
    [nameId]
  );

  if (synonyms.length === 0) {
    throw new Error(`Synonym ${nameId} not found`);
  }

  const synonym = synonyms[0];

  // Check if this is the last synonym for the group
  const groupSynonyms = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM species_name WHERE group_id = ?',
    [synonym.group_id]
  );

  const synonymCount = groupSynonyms[0]?.count || 0;

  if (synonymCount <= 1 && !force) {
    throw new Error(
      'Cannot delete the last synonym for a species. Each species must have at least one name. Use force=true to delete anyway.'
    );
  }

  // Check if any submissions use this specific name_id
  const submissions = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM submissions WHERE species_name_id = ?',
    [nameId]
  );

  const submissionCount = submissions[0]?.count || 0;

  try {
    const conn = writeConn;
    const stmt = await conn.prepare('DELETE FROM species_name WHERE name_id = ?');

    try {
      const result = await stmt.run(nameId);

      if (submissionCount > 0) {
        logger.warn('Deleted synonym used by submissions', {
          nameId,
          commonName: synonym.common_name,
          scientificName: synonym.scientific_name,
          submissionCount
        });
      }

      return result.changes || 0;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    logger.error('Failed to delete synonym', err);
    throw new Error('Failed to delete synonym');
  }
}

/**
 * Species group management for admin interface
 */

export type SpeciesAdminFilters = {
  species_type?: string;
  program_class?: string;
  has_base_points?: boolean;
  is_cares_species?: boolean;
  search?: string;
};

export type SpeciesAdminListItem = {
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
  species_type: string;
  program_class: string;
  base_points: number | null;
  is_cares_species: number;
  synonym_count: number;
};

export type SpeciesAdminListResult = {
  species: SpeciesAdminListItem[];
  total_count: number;
};

/**
 * Get species list for admin interface with filters and pagination - Split schema
 * Unlike the public explorer, this returns ALL species (not just those with breeding reports)
 *
 * **Migration Note**: Updated to query species_common_name and species_scientific_name tables
 * for search and name counting. Synonym count now includes both common and scientific names.
 *
 * @param filters - Filter criteria for species
 * @param sort - Sort order: 'name', 'points', or 'class' (default: 'name')
 * @param limit - Maximum results per page (default: 50)
 * @param offset - Number of results to skip for pagination (default: 0)
 * @returns Object with species array and total count for pagination
 */
export async function getSpeciesForAdmin(
  filters: SpeciesAdminFilters = {},
  sort: 'name' | 'points' | 'class' = 'name',
  limit = 50,
  offset = 0
): Promise<SpeciesAdminListResult> {
  const { species_type, program_class, has_base_points, is_cares_species, search } = filters;

  // Build WHERE conditions
  const conditions: string[] = ['1=1'];
  const params: unknown[] = [];

  if (species_type) {
    conditions.push('AND sng.species_type = ?');
    params.push(species_type);
  }

  if (program_class) {
    conditions.push('AND sng.program_class = ?');
    params.push(program_class);
  }

  if (has_base_points !== undefined) {
    conditions.push(has_base_points ? 'AND sng.base_points IS NOT NULL' : 'AND sng.base_points IS NULL');
  }

  if (is_cares_species !== undefined) {
    conditions.push('AND sng.is_cares_species = ?');
    params.push(is_cares_species ? 1 : 0);
  }

  if (search && search.trim().length >= 2) {
    const searchPattern = `%${search.trim().toLowerCase()}%`;
    conditions.push(`AND (
      LOWER(sng.canonical_genus) LIKE ? OR
      LOWER(sng.canonical_species_name) LIKE ? OR
      EXISTS (
        SELECT 1 FROM species_common_name cn
        WHERE cn.group_id = sng.group_id AND LOWER(cn.common_name) LIKE ?
      ) OR
      EXISTS (
        SELECT 1 FROM species_scientific_name sn
        WHERE sn.group_id = sng.group_id AND LOWER(sn.scientific_name) LIKE ?
      )
    )`);
    params.push(searchPattern, searchPattern, searchPattern, searchPattern);
  }

  // Build ORDER BY clause
  let orderBy = 'sng.canonical_genus, sng.canonical_species_name';
  if (sort === 'points') {
    orderBy = 'sng.base_points DESC NULLS LAST, sng.canonical_genus, sng.canonical_species_name';
  } else if (sort === 'class') {
    orderBy = 'sng.program_class, sng.canonical_genus, sng.canonical_species_name';
  }

  // Get total count
  const countSql = `
    SELECT COUNT(DISTINCT sng.group_id) as count
    FROM species_name_group sng
    WHERE ${conditions.join(' ')}
  `;
  const countResult = await query<{ count: number }>(countSql, params);
  const total_count = countResult[0]?.count || 0;

  // Get paginated results with synonym count from both tables
  const dataSql = `
    SELECT
      sng.group_id,
      sng.canonical_genus,
      sng.canonical_species_name,
      sng.species_type,
      sng.program_class,
      sng.base_points,
      sng.is_cares_species,
      (
        SELECT COUNT(*) FROM species_common_name cn WHERE cn.group_id = sng.group_id
      ) + (
        SELECT COUNT(*) FROM species_scientific_name sn WHERE sn.group_id = sng.group_id
      ) as synonym_count
    FROM species_name_group sng
    WHERE ${conditions.join(' ')}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const dataParams = [...params, limit, offset];
  const species = await query<SpeciesAdminListItem>(dataSql, dataParams);

  return {
    species,
    total_count
  };
}

/**
 * Create a new species group
 * @param data - Species group data
 * @returns The group_id of the newly created species group
 * @throws Error if validation fails or duplicate canonical name exists
 */
export async function createSpeciesGroup(data: {
  programClass: string;
  speciesType: string;
  canonicalGenus: string;
  canonicalSpeciesName: string;
  basePoints?: number | null;
  isCaresSpecies?: boolean;
}): Promise<number> {
  const {
    programClass,
    speciesType,
    canonicalGenus,
    canonicalSpeciesName,
    basePoints,
    isCaresSpecies
  } = data;

  // Validate inputs
  const trimmedGenus = canonicalGenus.trim();
  const trimmedSpecies = canonicalSpeciesName.trim();
  const trimmedClass = programClass.trim();

  if (!trimmedGenus || !trimmedSpecies) {
    throw new Error('Canonical genus and species name cannot be empty');
  }

  if (!trimmedClass) {
    throw new Error('Program class cannot be empty');
  }

  if (!['Fish', 'Plant', 'Invert', 'Coral'].includes(speciesType)) {
    throw new Error('Species type must be Fish, Plant, Invert, or Coral');
  }

  if (basePoints !== undefined && basePoints !== null && (basePoints < 0 || basePoints > 100)) {
    throw new Error('Base points must be between 0 and 100, or null');
  }

  try {
    const conn = writeConn;
    const stmt = await conn.prepare(`
      INSERT INTO species_name_group (
        program_class, species_type, canonical_genus, canonical_species_name,
        base_points, is_cares_species
      ) VALUES (?, ?, ?, ?, ?, ?)
      RETURNING group_id
    `);

    try {
      const result = await stmt.get<{ group_id: number }>(
        trimmedClass,
        speciesType,
        trimmedGenus,
        trimmedSpecies,
        basePoints ?? null,
        isCaresSpecies ? 1 : 0
      );

      if (!result || !result.group_id) {
        throw new Error('Failed to create species group');
      }

      logger.info('Created species group', {
        groupId: result.group_id,
        canonicalName: `${trimmedGenus} ${trimmedSpecies}`,
        speciesType,
        programClass: trimmedClass
      });

      return result.group_id;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      throw new Error(`Species "${trimmedGenus} ${trimmedSpecies}" already exists`);
    }
    logger.error('Failed to create species group', err);
    throw new Error('Failed to create species group');
  }
}

/**
 * Update a species group's metadata
 * @param groupId - Species group ID to update
 * @param updates - Fields to update (at least one required)
 * @returns Number of rows updated (0 if not found, 1 if successful)
 * @throws Error if no fields provided, empty values, or canonical name conflict
 */
export async function updateSpeciesGroup(
  groupId: number,
  updates: {
    canonicalGenus?: string;
    canonicalSpeciesName?: string;
    speciesType?: string;
    programClass?: string;
    basePoints?: number | null;
    isCaresSpecies?: boolean;
    externalReferences?: string[];
    imageLinks?: string[];
  }
): Promise<number> {
  const {
    canonicalGenus,
    canonicalSpeciesName,
    speciesType,
    programClass,
    basePoints,
    isCaresSpecies,
    externalReferences,
    imageLinks
  } = updates;

  // At least one field must be provided
  if (Object.keys(updates).length === 0) {
    throw new Error('At least one field must be provided');
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (canonicalGenus !== undefined) {
    const trimmed = canonicalGenus.trim();
    if (!trimmed) {
      throw new Error('Canonical genus cannot be empty');
    }
    fields.push('canonical_genus = ?');
    values.push(trimmed);
  }

  if (canonicalSpeciesName !== undefined) {
    const trimmed = canonicalSpeciesName.trim();
    if (!trimmed) {
      throw new Error('Canonical species name cannot be empty');
    }
    fields.push('canonical_species_name = ?');
    values.push(trimmed);
  }

  if (speciesType !== undefined) {
    if (!['Fish', 'Plant', 'Invert', 'Coral'].includes(speciesType)) {
      throw new Error('Species type must be Fish, Plant, Invert, or Coral');
    }
    fields.push('species_type = ?');
    values.push(speciesType);
  }

  if (programClass !== undefined) {
    const trimmed = programClass.trim();
    if (!trimmed) {
      throw new Error('Program class cannot be empty');
    }
    fields.push('program_class = ?');
    values.push(trimmed);
  }

  if (basePoints !== undefined) {
    if (basePoints !== null && (basePoints < 0 || basePoints > 100)) {
      throw new Error('Base points must be between 0 and 100, or null');
    }
    fields.push('base_points = ?');
    values.push(basePoints);
  }

  if (isCaresSpecies !== undefined) {
    fields.push('is_cares_species = ?');
    values.push(isCaresSpecies ? 1 : 0);
  }

  if (externalReferences !== undefined) {
    fields.push('external_references = ?');
    values.push(externalReferences.length > 0 ? JSON.stringify(externalReferences) : null);
  }

  if (imageLinks !== undefined) {
    fields.push('image_links = ?');
    values.push(imageLinks.length > 0 ? JSON.stringify(imageLinks) : null);
  }

  if (fields.length === 0) {
    throw new Error('No valid fields to update');
  }

  values.push(groupId);

  try {
    const conn = writeConn;
    const stmt = await conn.prepare(`
      UPDATE species_name_group
      SET ${fields.join(', ')}
      WHERE group_id = ?
    `);

    try {
      const result = await stmt.run(...values);
      return result.changes || 0;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    // Check for unique constraint on canonical_genus + canonical_species_name
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      throw new Error('A species with this canonical name already exists');
    }
    logger.error('Failed to update species group', err);
    throw new Error('Failed to update species group');
  }
}

/**
 * Delete a species group and all its synonyms
 * @param groupId - Species group ID to delete
 * @param force - If true, allows deleting species with approved submissions (default: false)
 * @returns Number of rows deleted (0 if not found, 1 if successful)
 * @throws Error if species has approved submissions without force flag
 */
export async function deleteSpeciesGroup(groupId: number, force = false): Promise<number> {
  // Verify species group exists
  const groups = await query<{ group_id: number; canonical_genus: string; canonical_species_name: string }>(
    'SELECT group_id, canonical_genus, canonical_species_name FROM species_name_group WHERE group_id = ?',
    [groupId]
  );

  if (groups.length === 0) {
    throw new Error(`Species group ${groupId} not found`);
  }

  // Check for approved submissions using new FK columns
  const submissions = await query<{ count: number }>(
    `SELECT COUNT(DISTINCT s.id) as count
     FROM submissions s
     LEFT JOIN species_common_name cn ON s.common_name_id = cn.common_name_id
     LEFT JOIN species_scientific_name scin ON s.scientific_name_id = scin.scientific_name_id
     WHERE (cn.group_id = ? OR scin.group_id = ?)
       AND s.approved_on IS NOT NULL`,
    [groupId, groupId]
  );

  const submissionCount = submissions[0]?.count || 0;

  if (submissionCount > 0 && !force) {
    throw new Error(
      `Species has ${submissionCount} approved submissions. Use force=true to delete anyway.`
    );
  }

  // Get synonym count before delete (for logging)
  const commonCount = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM species_common_name WHERE group_id = ?',
    [groupId]
  );
  const scientificCount = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM species_scientific_name WHERE group_id = ?',
    [groupId]
  );

  const synonymCount = (commonCount[0]?.count || 0) + (scientificCount[0]?.count || 0);

  try {
    const conn = writeConn;
    // Migration 031 added ON DELETE SET NULL to FK constraints,
    // so species names will be automatically nullified when deleted
    const stmt = await conn.prepare('DELETE FROM species_name_group WHERE group_id = ?');

    try {
      const result = await stmt.run(groupId);
      const changes = result.changes || 0;

      if (changes > 0) {
        logger.info('Deleted species group', {
          groupId,
          canonicalName: `${groups[0].canonical_genus} ${groups[0].canonical_species_name}`,
          synonymCount,
          submissionCount,
          forced: force
        });

        if (submissionCount > 0) {
          logger.warn('Deleted species with approved submissions', {
            groupId,
            submissionCount
          });
        }
      }

      return changes;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    logger.error('Failed to delete species group', err);
    throw new Error('Failed to delete species group');
  }
}

/**
 * Update base_points for multiple species groups at once
 * @param groupIds - Array of species group IDs to update
 * @param points - Point value to set (0-100 or null to clear)
 * @returns Number of species updated
 * @throws Error if invalid point value or no group IDs provided
 */
export async function bulkSetPoints(groupIds: number[], points: number | null): Promise<number> {
  if (!groupIds || groupIds.length === 0) {
    throw new Error('At least one group ID must be provided');
  }

  if (points !== null && (points < 0 || points > 100)) {
    throw new Error('Points must be between 0 and 100, or null');
  }

  try {
    const conn = writeConn;
    const placeholders = groupIds.map(() => '?').join(', ');
    const stmt = await conn.prepare(`
      UPDATE species_name_group
      SET base_points = ?
      WHERE group_id IN (${placeholders})
    `);

    try {
      const result = await stmt.run(points, ...groupIds);

      logger.info('Bulk updated species points', {
        groupIds,
        points,
        updatedCount: result.changes || 0
      });

      return result.changes || 0;
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    logger.error('Failed to bulk set points', err);
    throw new Error('Failed to bulk set points');
  }
}
