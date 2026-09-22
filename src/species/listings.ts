/**
 * The catalogue's read models: typeahead, the public explorer, the admin
 * list, a Species' detail page and its breeders. Moved here unchanged from the
 * old species data module; the paired common/scientific shapes some of them
 * return are for the old views and go when those views read Names by kind.
 */
import { query } from "@/db/conn";
import { getSpeciesExternalReferences, getSpeciesImages, type SpeciesImage } from "@/db/speciesEnrichment";
import { speciesIdOfSubmissionSql } from "./submissions";

export type SpeciesFilters = {
  species_type?: string;
  species_class?: string;
  search?: string;
  sort?: "name" | "reports" | "breeders";
  cares_only?: boolean;
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
  is_cares_species: number;
  iucn_redlist_category: string | null;
  iucn_population_trend: string | null;
  iucn_redlist_url: string | null;
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
  sort: "name" | "reports" | "breeders" = "reports",
  limit?: number,
  cares_only?: boolean
): { sql: string; params: unknown[] } {
  // Build ORDER BY clause
  let orderBy = "total_breeds DESC, total_breeders DESC";
  if (sort === "name") {
    orderBy = "sng.canonical_genus, sng.canonical_species_name";
  } else if (sort === "breeders") {
    orderBy = "total_breeders DESC, total_breeds DESC";
  }

  // Build WHERE conditions and parameters
  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];

  if (species_type) {
    conditions.push("AND s.species_type = ?");
    params.push(species_type);
  }

  if (species_class) {
    conditions.push("AND s.species_class = ?");
    params.push(species_class);
  }

  if (cares_only) {
    conditions.push("AND sng.is_cares_species = 1");
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
			sng.is_cares_species,
			sng.iucn_redlist_category,
			sng.iucn_population_trend,
			sng.iucn_redlist_url,
			COALESCE(COUNT(DISTINCT s.id), 0) as total_breeds,
			COALESCE(COUNT(DISTINCT s.member_id), 0) as total_breeders,
			COALESCE(GROUP_CONCAT(DISTINCT cn.common_name), '') as common_names,
			COALESCE(GROUP_CONCAT(DISTINCT scin.scientific_name), '') as scientific_names,
			MAX(s.approved_on) as latest_breed_date
		FROM species_name_group sng
		LEFT JOIN species_common_name cn ON sng.group_id = cn.group_id
		LEFT JOIN species_scientific_name scin ON sng.group_id = scin.group_id
		LEFT JOIN submissions s ON (s.common_name_id = cn.common_name_id OR s.scientific_name_id = scin.scientific_name_id) AND s.approved_on IS NOT NULL
		WHERE ${conditions.join(" ")}
		GROUP BY sng.group_id, sng.program_class, sng.canonical_genus, sng.canonical_species_name, sng.is_cares_species, sng.iucn_redlist_category, sng.iucn_population_trend, sng.iucn_redlist_url
		HAVING total_breeds > 0
		ORDER BY ${orderBy}
		${limit ? "LIMIT ?" : ""}
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
  filters: Omit<SpeciesFilters, "search" | "sort"> = {},
  limit: number = 10
): Promise<SpeciesNameRecord[]> {
  if (!searchQuery || searchQuery.trim().length < 2) {
    return [];
  }

  const searchPattern = `%${searchQuery.trim().toLowerCase()}%`;
  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];

  if (filters.species_type) {
    conditions.push("AND sng.species_type = ?");
    params.push(filters.species_type);
  }

  if (filters.species_class) {
    conditions.push("AND sng.program_class = ?");
    params.push(filters.species_class);
  }

  // Build WHERE clause for both queries
  const whereClause = conditions.join(" ");

  // UNION query: search both common names and scientific names
  // Each subquery joins with species_name_group for metadata
  // Uses canonical names from species_name_group as fallback for pairing
  const sql = `
    SELECT
      cn.common_name_id as name_id,
      cn.group_id,
      cn.common_name,
      COALESCE(
        (SELECT sn.scientific_name FROM species_scientific_name sn
         WHERE sn.group_id = cn.group_id
         ORDER BY sn.scientific_name
         LIMIT 1),
        sng.canonical_genus || ' ' || sng.canonical_species_name
      ) as scientific_name,
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
      COALESCE(
        (SELECT cn.common_name FROM species_common_name cn
         WHERE cn.group_id = sn.group_id
         ORDER BY cn.common_name
         LIMIT 1),
        sng.canonical_genus || ' ' || sng.canonical_species_name
      ) as common_name,
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

export async function getSpeciesForExplorer(
  filters: SpeciesFilters = {}
): Promise<SpeciesExplorerItem[]> {
  const { species_type, species_class, search, sort = "reports", cares_only } = filters;

  const { sql, params } = buildSpeciesSearchQuery(
    search,
    species_type,
    species_class,
    sort,
    undefined, // No limit for explorer - return all results
    cares_only
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
  iucn_redlist_category: string | null;
  iucn_population_trend: string | null;
  iucn_last_updated: string | null;
  iucn_redlist_id: number | null;
  iucn_redlist_url: string | null;
  external_references: string[]; // Array of reference URLs
  image_links: string[]; // Array of image URLs (backward compatibility)
  images: SpeciesImage[]; // Full image objects with metadata
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
    iucn_redlist_category: string | null;
    iucn_population_trend: string | null;
    iucn_last_updated: string | null;
    iucn_redlist_id: number | null;
    iucn_redlist_url: string | null;
  }>(
    `
		SELECT group_id, program_class, species_type, canonical_genus, canonical_species_name, base_points, is_cares_species, iucn_redlist_category, iucn_population_trend, iucn_last_updated, iucn_redlist_id, iucn_redlist_url
		FROM species_name_group
		WHERE group_id = ?
	`,
    [groupId]
  );

  if (groupRows.length === 0) {
    return null;
  }

  // Get all names from split schema tables
  const [commonNames, scientificNames] = await Promise.all([
    query<{ common_name_id: number; common_name: string }>(
      "SELECT common_name_id, common_name FROM species_common_name WHERE group_id = ? ORDER BY common_name",
      [groupId]
    ),
    query<{ scientific_name_id: number; scientific_name: string }>(
      "SELECT scientific_name_id, scientific_name FROM species_scientific_name WHERE group_id = ? ORDER BY scientific_name",
      [groupId]
    ),
  ]);

  // Create paired synonyms for backward compatibility with existing views
  // Each common name is paired with the first scientific name
  const synonymRows = commonNames.map((cn, idx) => ({
    name_id: cn.common_name_id,
    common_name: cn.common_name,
    scientific_name:
      scientificNames[idx]?.scientific_name || scientificNames[0]?.scientific_name || "",
  }));

  // Fetch normalized data
  const [externalRefs, images] = await Promise.all([
    getSpeciesExternalReferences(groupId),
    getSpeciesImages(groupId),
  ]);

  const detail: SpeciesDetail = {
    ...groupRows[0],
    external_references: externalRefs.map((ref) => ref.reference_url),
    image_links: images.map((img) => img.image_url), // Backward compatibility
    images, // Full objects with metadata
    synonyms: synonymRows,
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
  return query<SpeciesBreeder>(
    `
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
		WHERE ${speciesIdOfSubmissionSql("s")} = ?
		  AND s.approved_on IS NOT NULL
		GROUP BY m.id, m.display_name
		ORDER BY breed_count DESC, latest_breed_date DESC
	`,
    [groupId]
  ).then((rows) => {
    return rows.map((row) => ({
      ...row,
      submissions: row.submissions_concat
        ? row.submissions_concat.split(",").map((sub: string) => {
            const [id, common_name, latin_name, approved_on, points] = sub.split("|");
            return {
              id: parseInt(id),
              species_common_name: common_name,
              species_latin_name: latin_name,
              approved_on,
              points: parseInt(points),
            };
          })
        : [],
    }));
  });
}

/**
 * Species group management for admin interface
 */

export type SpeciesAdminFilters = {
  species_type?: string;
  program_class?: string;
  has_base_points?: boolean;
  is_cares_species?: boolean;
  iucn_category?: string; // Specific IUCN category or special values: 'with_data', 'missing'
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
  iucn_redlist_category: string | null;
  iucn_population_trend: string | null;
  iucn_last_updated: string | null;
  iucn_redlist_url: string | null;
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
  sort: "name" | "points" | "class" = "name",
  limit = 50,
  offset = 0
): Promise<SpeciesAdminListResult> {
  const { species_type, program_class, has_base_points, is_cares_species, iucn_category, search } =
    filters;

  // Build WHERE conditions
  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];

  if (species_type) {
    conditions.push("AND sng.species_type = ?");
    params.push(species_type);
  }

  if (program_class) {
    conditions.push("AND sng.program_class = ?");
    params.push(program_class);
  }

  if (has_base_points !== undefined) {
    conditions.push(
      has_base_points ? "AND sng.base_points IS NOT NULL" : "AND sng.base_points IS NULL"
    );
  }

  if (is_cares_species !== undefined) {
    conditions.push("AND sng.is_cares_species = ?");
    params.push(is_cares_species ? 1 : 0);
  }

  if (iucn_category) {
    if (iucn_category === "with_data") {
      conditions.push("AND sng.iucn_redlist_category IS NOT NULL");
    } else if (iucn_category === "missing") {
      conditions.push("AND sng.iucn_redlist_category IS NULL");
    } else {
      // Specific IUCN category (CR, EN, VU, etc.)
      conditions.push("AND sng.iucn_redlist_category = ?");
      params.push(iucn_category);
    }
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
  let orderBy = "sng.canonical_genus, sng.canonical_species_name";
  if (sort === "points") {
    orderBy = "sng.base_points DESC NULLS LAST, sng.canonical_genus, sng.canonical_species_name";
  } else if (sort === "class") {
    orderBy = "sng.program_class, sng.canonical_genus, sng.canonical_species_name";
  }

  // Get total count
  const countSql = `
    SELECT COUNT(DISTINCT sng.group_id) as count
    FROM species_name_group sng
    WHERE ${conditions.join(" ")}
  `;
  const countResult = await query<{ count: number }>(countSql, params);
  const total_count = countResult[0]?.count || 0;

  // Get paginated results with synonym count from both tables and IUCN data
  const dataSql = `
    SELECT
      sng.group_id,
      sng.canonical_genus,
      sng.canonical_species_name,
      sng.species_type,
      sng.program_class,
      sng.base_points,
      sng.is_cares_species,
      sng.iucn_redlist_category,
      sng.iucn_population_trend,
      sng.iucn_last_updated,
      sng.iucn_redlist_url,
      (
        SELECT COUNT(*) FROM species_common_name cn WHERE cn.group_id = sng.group_id
      ) + (
        SELECT COUNT(*) FROM species_scientific_name sn WHERE sn.group_id = sng.group_id
      ) as synonym_count
    FROM species_name_group sng
    WHERE ${conditions.join(" ")}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const dataParams = [...params, limit, offset];
  const species = await query<SpeciesAdminListItem>(dataSql, dataParams);

  // Fetch all synonyms for these species in batch
  if (species.length > 0) {
    const groupIds = species.map((s) => s.group_id);
    const placeholders = groupIds.map(() => "?").join(",");

    const [commonNames, scientificNames] = await Promise.all([
      query<{ group_id: number; common_name: string }>(
        `SELECT group_id, common_name
         FROM species_common_name
         WHERE group_id IN (${placeholders})
         ORDER BY group_id, common_name`,
        groupIds
      ),
      query<{ group_id: number; scientific_name: string }>(
        `SELECT group_id, scientific_name
         FROM species_scientific_name
         WHERE group_id IN (${placeholders})
         ORDER BY group_id, scientific_name`,
        groupIds
      ),
    ]);

    // Group synonyms by group_id
    const commonByGroup = new Map<number, string[]>();
    const scientificByGroup = new Map<number, string[]>();

    commonNames.forEach((cn) => {
      if (!commonByGroup.has(cn.group_id)) {
        commonByGroup.set(cn.group_id, []);
      }
      commonByGroup.get(cn.group_id)!.push(cn.common_name);
    });

    scientificNames.forEach((sn) => {
      if (!scientificByGroup.has(sn.group_id)) {
        scientificByGroup.set(sn.group_id, []);
      }
      scientificByGroup.get(sn.group_id)!.push(sn.scientific_name);
    });

    // Attach to each species (safe to extend the object)
    species.forEach((s) => {
      const extended = s as SpeciesAdminListItem & {
        common_names: string[];
        scientific_names: string[];
      };
      extended.common_names = commonByGroup.get(s.group_id) || [];
      extended.scientific_names = scientificByGroup.get(s.group_id) || [];
    });
  }

  return {
    species,
    total_count,
  };
}
