import { query, withTransaction } from "./conn";
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
  return query<NameSynonym>(`
		SELECT
			species_name_group.group_id as name_group_id,
			species_name_group.program_class as program_class,
			species_name_group.canonical_genus as canonical_genus,
			species_name_group.canonical_species_name as canonical_species_name,
			species_name.common_name as common_name,
			species_name.scientific_name as scientific_name
		FROM species_name_group LEFT JOIN species_name
		ON species_name_group.group_id = species_name.group_id
	`);
}

export async function recordName(data: NameSynonym): Promise<number> {
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

      // Insert or update the species name synonym
      const nameStmt = await db.prepare(`
				INSERT INTO species_name(
					group_id,
					common_name,
					scientific_name
				)
				VALUES (?, ?, ?)
				ON CONFLICT(common_name, scientific_name)
				DO UPDATE SET group_id = group_id;
			`);
      await nameStmt.run(group_id, data.common_name, data.latin_name);
      await nameStmt.finalize();

      return group_id;
    });
  } catch (err) {
    logger.error('Failed to record species name', err);
    throw new Error("Failed to record species name");
  }
}

export async function mergeSpecies(canonicalGroupId: number, defunctGroupId: number): Promise<void> {
  try {
    await withTransaction(async (db) => {
      // Update all species names to point to the canonical group
      const updateStmt = await db.prepare(`
				UPDATE species_name
				SET group_id = ?
				WHERE group_id = ?
			`);
      await updateStmt.run(canonicalGroupId, defunctGroupId);
      await updateStmt.finalize();

      // Delete the defunct species group
      const deleteStmt = await db.prepare(`
				DELETE FROM species_name_group
				WHERE group_id = ?
			`);
      await deleteStmt.run(defunctGroupId);
      await deleteStmt.finalize();
    });
  } catch (err) {
    logger.error('Failed to record species name', err);
    logger.error('Failed to merge species groups', err);
    throw new Error("Failed to merge species groups");
  }
}

export async function getCanonicalSpeciesName(speciesNameId: number) {
  const rows = await query<{
		program_class: string;
		canonical_genus: string;
		canonical_species_name: string;
	}>(`
		SELECT species_name_group.*
		FROM species_name JOIN species_name_group
		ON species_name.group_id = species_name_group.group_id
		WHERE species_name.name_id = ?`,
	[speciesNameId]
	);
  return rows.pop();
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
			LOWER(sn.common_name) LIKE ? OR
			LOWER(sn.scientific_name) LIKE ?
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
			COALESCE(GROUP_CONCAT(DISTINCT sn.common_name), '') as common_names,
			COALESCE(GROUP_CONCAT(DISTINCT sn.scientific_name), '') as scientific_names,
			MAX(s.approved_on) as latest_breed_date
		FROM species_name_group sng
		LEFT JOIN species_name sn ON sng.group_id = sn.group_id
		LEFT JOIN submissions s ON s.species_name_id = sn.name_id AND s.approved_on IS NOT NULL
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
 * Search species names for typeahead/autocomplete
 * Returns individual name records (not grouped) with name_id for foreign key reference
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
    conditions.push('AND sng.program_class = ?');
    params.push(filters.species_type);
  }

  if (filters.species_class) {
    // Note: species_class filter would need to be stored somewhere to work here
    // For now, we filter by program_class (species_type) only
  }

  conditions.push(`AND (
    LOWER(sn.common_name) LIKE ? OR
    LOWER(sn.scientific_name) LIKE ?
  )`);
  params.push(searchPattern, searchPattern);
  params.push(limit);

  const sql = `
    SELECT
      sn.name_id,
      sn.group_id,
      sn.common_name,
      sn.scientific_name,
      sng.program_class,
      sng.canonical_genus,
      sng.canonical_species_name
    FROM species_name sn
    JOIN species_name_group sng ON sn.group_id = sng.group_id
    WHERE ${conditions.join(' ')}
    ORDER BY sn.common_name, sn.scientific_name
    LIMIT ?
  `;

  return query(sql, params);
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
	canonical_genus: string;
	canonical_species_name: string;
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
		canonical_genus: string;
		canonical_species_name: string;
	}>(`
		SELECT group_id, program_class, canonical_genus, canonical_species_name
		FROM species_name_group
		WHERE group_id = ?
	`, [groupId]);

  if (groupRows.length === 0) {
    return null;
  }

  const synonymRows = await query<{
		name_id: number;
		common_name: string;
		scientific_name: string;
	}>(`
		SELECT name_id, common_name, scientific_name
		FROM species_name
		WHERE group_id = ?
		ORDER BY common_name, scientific_name
	`, [groupId]);

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
		JOIN species_name sn ON s.species_name_id = sn.name_id
		WHERE sn.group_id = ? AND s.approved_on IS NOT NULL
		GROUP BY m.id, m.display_name
		ORDER BY breed_count DESC, latest_breed_date DESC
	`, [groupId]).then(rows => {
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
