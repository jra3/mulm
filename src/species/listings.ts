/**
 * The catalogue's read models: typeahead, the public explorer, the admin
 * list, a Species' detail page and its breeders. Moved here unchanged from the
 * old species data module; the paired common/scientific shapes some of them
 * return are for the old views and go when those views read Names by kind.
 */
import { query } from "@/db/conn";
import { getSpeciesExternalReferences, getSpeciesImages, type SpeciesImage } from "@/db/speciesEnrichment";
import type { SpeciesType } from "@/points";
import { speciesIdOfSubmissionSql } from "./submissions";
import { listNames } from "./names";
import type { NameKind, Species, SpeciesNames } from "./types";

export type SpeciesFilters = {
  species_type?: string;
  /**
   * The explorer filters on the Submission's copy of the Program class, whose
   * column is `species_class`; the typeahead filters on the Species' Program
   * class. The field keeps the query parameter's name.
   */
  species_class?: string;
  search?: string;
  sort?: "name" | "reports" | "breeders";
  cares_only?: boolean;
};

export type SpeciesExplorerItem = {
  /** The Species' id (its schema column is `group_id`). */
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
 * One typeahead result: the Name that matched, and what a form should fill
 * in beside it. A common Name comes with the Species' Canonical name as its
 * scientific spelling; a scientific Name comes with the Species' first common
 * Name, or an empty string when it has none. Nothing is paired that the
 * catalogue does not hold.
 */
export type SpeciesNameRecord = {
  name_id: number;
  kind: NameKind;
  /** The Species' id (its schema column is `group_id`). */
  group_id: number;
  common_name: string;
  scientific_name: string;
  program_class: string;
  species_type: string;
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
  programClassAsSubmitted?: string,
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

  if (programClassAsSubmitted) {
    conditions.push("AND s.species_class = ?");
    params.push(programClassAsSubmitted);
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
 * Search Names for typeahead: one result per matching common or scientific
 * Name, each carrying its Species' classification and Canonical name.
 *
 * @param searchQuery - Search term (minimum 2 characters)
 * @param filters - Optional Species type and Program class filters
 * @param limit - Maximum number of results (default: 10)
 * @returns One record per matching Name
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

  const sql = `
    SELECT
      cn.common_name_id AS name_id,
      'common' AS kind,
      cn.group_id,
      cn.common_name,
      sng.canonical_genus || ' ' || sng.canonical_species_name AS scientific_name,
      sng.program_class,
      sng.species_type,
      sng.canonical_genus,
      sng.canonical_species_name,
      1 AS is_common_name
    FROM species_common_name cn
    JOIN species_name_group sng ON cn.group_id = sng.group_id
    WHERE ${whereClause} AND LOWER(cn.common_name) LIKE ?

    UNION ALL

    SELECT
      sn.scientific_name_id AS name_id,
      'scientific' AS kind,
      sn.group_id,
      COALESCE(
        (SELECT cn.common_name FROM species_common_name cn
         WHERE cn.group_id = sn.group_id
         ORDER BY cn.common_name
         LIMIT 1),
        ''
      ) AS common_name,
      sn.scientific_name,
      sng.program_class,
      sng.species_type,
      sng.canonical_genus,
      sng.canonical_species_name,
      0 AS is_common_name
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
  /** The Species' id (its schema column is `group_id`). */
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
  /** The Species' Names by kind. */
  names: SpeciesNames;
};

/** One Species with its Names by kind, IUCN status, external references and images; null if missing. */
export async function getSpeciesDetail(speciesId: number): Promise<SpeciesDetail | null> {
  const speciesRows = await query<{
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
    [speciesId]
  );

  if (speciesRows.length === 0) {
    return null;
  }

  // Fetch normalized data
  const [names, externalRefs, images] = await Promise.all([
    listNames(speciesId),
    getSpeciesExternalReferences(speciesId),
    getSpeciesImages(speciesId),
  ]);

  const detail: SpeciesDetail = {
    ...speciesRows[0],
    external_references: externalRefs.map((ref) => ref.reference_url),
    image_links: images.map((img) => img.image_url), // Backward compatibility
    images, // Full objects with metadata
    names,
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
 * @param speciesId - the Species' id
 * @returns Array of breeders with their breeding statistics for this species
 */
export async function getBreedersForSpecies(speciesId: number) {
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
    [speciesId]
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

/** The Species types that have approved Submissions, for the explorer's filter. */
export async function getExplorerFilterOptions() {
  const speciesTypes = await query<{ species_type: string }>(`
		SELECT DISTINCT species_type
		FROM submissions
		WHERE approved_on IS NOT NULL
		ORDER BY species_type
	`);

  return {
    species_types: speciesTypes.map((s) => s.species_type),
  };
}

/**
 * Species of a type whose IUCN status was last synced before a date, or
 * never, oldest first. The IUCN sync decides what to do with them; the
 * catalogue only lists them.
 */
export async function listSpeciesDueIucnSync(
  speciesType: SpeciesType,
  syncedBefore: Date,
  limit: number
): Promise<
  Array<
    Pick<Species, "group_id" | "canonical_genus" | "canonical_species_name" | "iucn_last_updated">
  >
> {
  return query(
    `SELECT group_id, canonical_genus, canonical_species_name, iucn_last_updated
     FROM species_name_group
     WHERE species_type = ?
       AND (iucn_last_updated IS NULL OR iucn_last_updated < ?)
     ORDER BY iucn_last_updated ASC NULLS FIRST
     LIMIT ?`,
    [speciesType, syncedBefore.toISOString(), limit]
  );
}

/**
 * The admin list of Species
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
  /** The Species' id (its schema column is `group_id`). */
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
  species_type: string;
  program_class: string;
  base_points: number | null;
  is_cares_species: number;
  /** How many Names the Species has, of both kinds. */
  name_count: number;
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
 * The admin list of Species, filtered and paginated. Unlike the public
 * explorer it returns every Species, bred or not, with its Names of both kinds.
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

  // One page of Species, with a count of their Names of both kinds and IUCN data
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
      ) as name_count
    FROM species_name_group sng
    WHERE ${conditions.join(" ")}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const dataParams = [...params, limit, offset];
  const species = await query<SpeciesAdminListItem>(dataSql, dataParams);

  // Fetch the Names of every Species on this page in one query per kind
  if (species.length > 0) {
    const speciesIds = species.map((s) => s.group_id);
    const placeholders = speciesIds.map(() => "?").join(",");

    const [commonNames, scientificNames] = await Promise.all([
      query<{ group_id: number; common_name: string }>(
        `SELECT group_id, common_name
         FROM species_common_name
         WHERE group_id IN (${placeholders})
         ORDER BY group_id, common_name`,
        speciesIds
      ),
      query<{ group_id: number; scientific_name: string }>(
        `SELECT group_id, scientific_name
         FROM species_scientific_name
         WHERE group_id IN (${placeholders})
         ORDER BY group_id, scientific_name`,
        speciesIds
      ),
    ]);

    // Names by Species
    const commonBySpecies = new Map<number, string[]>();
    const scientificBySpecies = new Map<number, string[]>();

    commonNames.forEach((cn) => {
      if (!commonBySpecies.has(cn.group_id)) {
        commonBySpecies.set(cn.group_id, []);
      }
      commonBySpecies.get(cn.group_id)!.push(cn.common_name);
    });

    scientificNames.forEach((sn) => {
      if (!scientificBySpecies.has(sn.group_id)) {
        scientificBySpecies.set(sn.group_id, []);
      }
      scientificBySpecies.get(sn.group_id)!.push(sn.scientific_name);
    });

    // Attach to each species (safe to extend the object)
    species.forEach((s) => {
      const extended = s as SpeciesAdminListItem & {
        common_names: string[];
        scientific_names: string[];
      };
      extended.common_names = commonBySpecies.get(s.group_id) || [];
      extended.scientific_names = scientificBySpecies.get(s.group_id) || [];
    });
  }

  return {
    species,
    total_count,
  };
}

export type SpeciesStatistics = {
  total_species: number;
  by_type: Partial<Record<SpeciesType, number>>;
  top_program_classes: Array<{ program_class: string; count: number }>;
  cares_species: number;
  with_base_points: number;
  without_base_points: number;
};

/** Counts across the catalogue: by Species type, the ten largest Program classes, CARES, Point class set or unset. */
export async function getSpeciesStatistics(): Promise<SpeciesStatistics> {
  const [totals, byType, byClass] = await Promise.all([
    query<{ total: number; cares: number; with_points: number }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(is_cares_species = 1), 0) AS cares,
              COALESCE(SUM(base_points IS NOT NULL), 0) AS with_points
       FROM species_name_group`
    ),
    query<{ species_type: string; count: number }>(
      "SELECT species_type, COUNT(*) AS count FROM species_name_group GROUP BY species_type ORDER BY species_type"
    ),
    query<{ program_class: string; count: number }>(
      "SELECT program_class, COUNT(*) AS count FROM species_name_group GROUP BY program_class ORDER BY count DESC LIMIT 10"
    ),
  ]);
  const { total, cares, with_points } = totals[0];
  return {
    total_species: total,
    by_type: Object.fromEntries(byType.map((t) => [t.species_type, t.count])),
    top_program_classes: byClass,
    cares_species: cares,
    with_base_points: with_points,
    without_base_points: total - with_points,
  };
}
