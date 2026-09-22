/**
 * The old species data module, during the move to the Species catalogue.
 *
 * Everything that has a home in the catalogue (`@/species`) is re-exported or
 * delegated from here so no caller changes while the catalogue lands; callers
 * migrate to `@/species` ticket by ticket and this file then goes. What is
 * still implemented here is what the catalogue deliberately does not carry:
 * the deprecated functions that pair a common Name with a scientific one and
 * orphan exports. The CARES queries now live in the CARES data module and are
 * re-exported here.
 */
import { query, writeConn, withTransaction } from "./conn";
import { logger } from "@/utils/logger";
import {
  CatalogueRefusal,
  findSpeciesByCanonicalName,
  addName,
  countSubmissionsOfSpecies,
  createSpecies,
  deleteSpecies,
  findSpeciesById,
  listNames,
  removeName,
  renameCanonical,
  setPointClass,
  updateSpecies,
  type Name,
  type Species,
} from "@/species";
import { setSpeciesExternalReferences, setSpeciesImages } from "./speciesEnrichment";

export {
  getCaresCoverageStats,
  getCaresMaintenersForSpecies,
  type CaresCoverageStats,
} from "./cares";

export {
  mergeSpecies,
  getExplorerFilterOptions as getFilterOptions,
  searchSpeciesTypeahead,
  getSpeciesForExplorer,
  getSpeciesForAdmin,
  getSpeciesDetail,
  getBreedersForSpecies,
  type SpeciesFilters,
  type SpeciesExplorerItem,
  type SpeciesNameRecord,
  type SpeciesAdminFilters,
  type SpeciesAdminListItem,
  type SpeciesAdminListResult,
  type SpeciesDetail,
  type SpeciesBreeder,
} from "@/species";

export {
  getSpeciesExternalReferences,
  setSpeciesExternalReferences,
  getSpeciesImages,
  setSpeciesImages,
  setSpeciesImagesWithMetadata,
  type SpeciesExternalReference,
  type SpeciesImage,
  type SpeciesImageInput,
} from "./speciesEnrichment";

type NameSynonym = {
  /** Not a phylogenetic class. The species class for the BAP program */
  program_class: string;
  canonical_genus: string;
  canonical_species_name: string;
  common_name: string;
  /** Typically a simple combination of genus and species */
  latin_name: string;
};

export async function querySpeciesNames() {
  // Query split schema tables and create paired records
  const groups = await query<{
    group_id: number;
    program_class: string;
    canonical_genus: string;
    canonical_species_name: string;
  }>(
    "SELECT group_id, program_class, canonical_genus, canonical_species_name FROM species_name_group"
  );

  const results: NameSynonym[] = [];

  for (const group of groups) {
    const [commonNames, scientificNames] = await Promise.all([
      query<{ common_name: string }>(
        "SELECT common_name FROM species_common_name WHERE group_id = ? ORDER BY common_name",
        [group.group_id]
      ),
      query<{ scientific_name: string }>(
        "SELECT scientific_name FROM species_scientific_name WHERE group_id = ? ORDER BY scientific_name",
        [group.group_id]
      ),
    ]);

    // Pair common names with scientific names
    const maxLength = Math.max(commonNames.length, scientificNames.length);
    for (let i = 0; i < maxLength; i++) {
      results.push({
        program_class: group.program_class,
        canonical_genus: group.canonical_genus,
        canonical_species_name: group.canonical_species_name,
        common_name: commonNames[i]?.common_name || commonNames[0]?.common_name || "",
        latin_name:
          scientificNames[i]?.scientific_name || scientificNames[0]?.scientific_name || "",
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
      const commonResult = await commonNameStmt.get<{ common_name_id: number }>(
        group_id,
        data.common_name
      );
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
      const scientificResult = await scientificNameStmt.get<{ scientific_name_id: number }>(
        group_id,
        data.latin_name
      );
      await scientificNameStmt.finalize();

      if (!scientificResult || !scientificResult.scientific_name_id) {
        throw new Error("Failed to insert scientific name");
      }

      return {
        group_id,
        common_name_id: commonResult.common_name_id,
        scientific_name_id: scientificResult.scientific_name_id,
      };
    });
  } catch (err) {
    logger.error("Failed to record species name", err);
    throw new Error("Failed to record species name");
  }
}

/** Delegates to `findSpeciesById` in `@/species`. */
export async function getSpeciesGroup(groupId: number): Promise<Species | undefined> {
  return findSpeciesById(groupId);
}

/**
 * Get species group_id from a common_name_id or scientific_name_id
 * @param nameId - Either a common_name_id or scientific_name_id
 * @param isCommonName - If true, treats nameId as common_name_id; if false, as scientific_name_id
 * @returns group_id or undefined if not found
 */
export async function getGroupIdFromNameId(
  nameId: number,
  isCommonName: boolean
): Promise<number | undefined> {
  if (isCommonName) {
    const rows = await query<{ group_id: number }>(
      "SELECT group_id FROM species_common_name WHERE common_name_id = ?",
      [nameId]
    );
    return rows.pop()?.group_id;
  } else {
    const rows = await query<{ group_id: number }>(
      "SELECT group_id FROM species_scientific_name WHERE scientific_name_id = ?",
      [nameId]
    );
    return rows.pop()?.group_id;
  }
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

const asCommonName = (n: Name): CommonName => ({
  common_name_id: n.name_id,
  group_id: n.species_id,
  common_name: n.name,
});
const asScientificName = (n: Name): ScientificName => ({
  scientific_name_id: n.name_id,
  group_id: n.species_id,
  scientific_name: n.name,
});

/** Delegates to `listNames` in `@/species`. */
export async function getCommonNamesForGroup(groupId: number): Promise<CommonName[]> {
  return (await listNames(groupId)).common.map(asCommonName);
}

/** Delegates to `listNames` in `@/species`. */
export async function getScientificNamesForGroup(groupId: number): Promise<ScientificName[]> {
  return (await listNames(groupId)).scientific.map(asScientificName);
}

/** Delegates to `listNames` in `@/species`. */
export async function getNamesForGroup(groupId: number): Promise<SpeciesNames> {
  const names = await listNames(groupId);
  return {
    common_names: names.common.map(asCommonName),
    scientific_names: names.scientific.map(asScientificName),
  };
}

/**
 * DEPRECATED: Get synonyms from old paired table (for backwards compatibility)
 * Use getNamesForGroup() for new code
 *
 * After migration 030, returns empty array since species_name table no longer exists
 */
export async function getSynonymsForGroup(groupId: number): Promise<SpeciesSynonym[]> {
  // Post-migration 030: species_name table no longer exists
  // Return data from split tables (species_common_name and species_scientific_name)

  const [commonNames, scientificNames] = await Promise.all([
    query<{ common_name_id: number; group_id: number; common_name: string }>(
      "SELECT common_name_id, group_id, common_name FROM species_common_name WHERE group_id = ? ORDER BY common_name",
      [groupId]
    ),
    query<{ scientific_name_id: number; group_id: number; scientific_name: string }>(
      "SELECT scientific_name_id, group_id, scientific_name FROM species_scientific_name WHERE group_id = ? ORDER BY scientific_name",
      [groupId]
    ),
  ]);

  // Return cross-product of common names × scientific names
  // This maintains backward compatibility with the old paired model
  const results: SpeciesSynonym[] = [];

  if (commonNames.length === 0 || scientificNames.length === 0) {
    // If either is empty, pair whatever exists with empty string
    for (const cn of commonNames) {
      results.push({
        name_id: cn.common_name_id,
        group_id: cn.group_id,
        common_name: cn.common_name,
        scientific_name: "",
      });
    }
    for (const sn of scientificNames) {
      results.push({
        name_id: sn.scientific_name_id,
        group_id: sn.group_id,
        common_name: "",
        scientific_name: sn.scientific_name,
      });
    }
  } else {
    // Create cross product of all common names with all scientific names
    for (const cn of commonNames) {
      for (const sn of scientificNames) {
        results.push({
          name_id: cn.common_name_id, // Use common_name_id as the ID
          group_id: cn.group_id,
          common_name: cn.common_name,
          scientific_name: sn.scientific_name,
        });
      }
    }
  }

  return results;
}

/** Delegates to `addName` in `@/species`. */
export function addCommonName(groupId: number, commonName: string): Promise<number> {
  return addName(groupId, "common", commonName);
}

/** Delegates to `addName` in `@/species`. */
export function addScientificName(groupId: number, scientificName: string): Promise<number> {
  return addName(groupId, "scientific", scientificName);
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
    throw new Error("Common name cannot be empty");
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
    if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
      throw new Error("This common name already exists for this species");
    }
    logger.error("Failed to update common name", err);
    throw new Error("Failed to update common name");
  }
}

/**
 * Update a scientific name
 * @param scientificNameId - Scientific name ID to update
 * @param newName - New scientific name value
 * @returns Number of rows updated (0 if not found, 1 if successful)
 * @throws Error if empty name or duplicate
 */
export async function updateScientificName(
  scientificNameId: number,
  newName: string
): Promise<number> {
  const trimmed = newName.trim();

  if (!trimmed) {
    throw new Error("Scientific name cannot be empty");
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
    if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
      throw new Error("This scientific name already exists for this species");
    }
    logger.error("Failed to update scientific name", err);
    throw new Error("Failed to update scientific name");
  }
}

/** Delegates to `removeName` in `@/species`. */
export function deleteCommonName(commonNameId: number): Promise<number> {
  return removeName("common", commonNameId);
}

/** Delegates to `removeName` in `@/species`. */
export function deleteScientificName(scientificNameId: number): Promise<number> {
  return removeName("scientific", scientificNameId);
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
  // Post-migration 030: Insert into both split tables
  // Returns the common_name_id as the primary identifier

  const trimmedCommon = commonName.trim();
  const trimmedScientific = scientificName.trim();

  if (!trimmedCommon || !trimmedScientific) {
    throw new Error("Common name and scientific name cannot be empty");
  }

  // Verify species group exists
  const groups = await query<{ group_id: number }>(
    "SELECT group_id FROM species_name_group WHERE group_id = ?",
    [groupId]
  );

  if (groups.length === 0) {
    throw new Error(`Species group ${groupId} not found`);
  }

  try {
    // Add common name
    const commonNameId = await addCommonName(groupId, trimmedCommon);

    // Add scientific name (ignore duplicates since it might already exist)
    try {
      await addScientificName(groupId, trimmedScientific);
    } catch (err) {
      // If scientific name already exists, that's OK - we still added the common name
      if (!(err instanceof Error && err.message.includes("already exists"))) {
        throw err;
      }
    }

    return commonNameId;
  } catch (err) {
    if (err instanceof Error && err.message.includes("already exists")) {
      throw new Error(`Synonym "${trimmedCommon} (${trimmedScientific})" already exists`);
    }
    logger.error("Failed to add synonym", err);
    throw new Error("Failed to add synonym");
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
  // Post-migration 030: nameId is always a common_name_id (from getSynonymsForGroup)
  // This function only updates common names for backward compatibility

  const { commonName, scientificName } = updates;

  // At least one field must be provided
  if (commonName === undefined && scientificName === undefined) {
    throw new Error("At least one field (commonName or scientificName) must be provided");
  }

  // Only common name updates are supported via this wrapper
  // (nameId comes from getSynonymsForGroup which returns common_name_id)
  if (scientificName !== undefined) {
    throw new Error(
      "updateSynonym() only supports updating common names. Use updateScientificName() directly to update scientific names."
    );
  }

  if (commonName !== undefined) {
    return await updateCommonName(nameId, commonName);
  }

  return 0;
}

/**
 * Delete a name variant (synonym) from a species group
 * @param nameId - Name variant ID to delete
 * @param force - If true, allows deleting the last synonym for a species (default: false)
 * @returns Number of rows deleted (0 if not found, 1 if successful)
 * @throws Error if trying to delete last synonym without force flag
 */
export async function deleteSynonym(nameId: number, force = false): Promise<number> {
  // Post-migration 030: nameId is always a common_name_id (from getSynonymsForGroup)
  // This function only deletes common names for backward compatibility

  // Verify the common name exists and get its group
  const commonNameRecords = await query<{ common_name_id: number; group_id: number }>(
    "SELECT common_name_id, group_id FROM species_common_name WHERE common_name_id = ?",
    [nameId]
  );

  if (commonNameRecords.length === 0) {
    throw new Error(`Common name ID ${nameId} not found`);
  }

  const groupId = commonNameRecords[0].group_id;

  // Check if this is the last common name for the group (only if not force)
  if (!force) {
    const groupCommonNames = await query<{ count: number }>(
      "SELECT COUNT(*) as count FROM species_common_name WHERE group_id = ?",
      [groupId]
    );

    const count = groupCommonNames[0]?.count || 0;
    if (count <= 1) {
      throw new Error(
        "Cannot delete the last common name for a species. Each species must have at least one common name. Use force=true to delete anyway."
      );
    }
  }

  return await deleteCommonName(nameId);
}

/** Delegates to `createSpecies` in `@/species`; `basePoints` is the Point class. */
export function createSpeciesGroup(data: {
  programClass: string;
  speciesType: string;
  canonicalGenus: string;
  canonicalSpeciesName: string;
  basePoints?: number | null;
  isCaresSpecies?: boolean;
}): Promise<number> {
  const { basePoints, ...rest } = data;
  return createSpecies({ ...rest, pointClass: basePoints });
}

/**
 * Delegates to the catalogue: a changed Canonical name goes through
 * `renameCanonical` (the old one is kept as a scientific Name), classification,
 * Point class and CARES through `updateSpecies`, and external references and
 * images to their enrichment module.
 * @returns 1 if the Species was updated, 0 if it does not exist
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
  if (Object.keys(updates).length === 0) {
    throw new CatalogueRefusal("At least one field must be provided", "invalid");
  }
  const {
    canonicalGenus,
    canonicalSpeciesName,
    speciesType,
    programClass,
    basePoints,
    isCaresSpecies,
    externalReferences,
    imageLinks,
  } = updates;

  const species = await findSpeciesById(groupId);
  if (!species) return 0;

  // The old function was one UPDATE; this is two catalogue calls. Refuse a
  // rename before anything is written, so a refusal never half-applies: the
  // classification update validates before it writes, and the rename's only
  // refusal after its own checks is a Canonical name another Species holds.
  const renaming = canonicalGenus !== undefined || canonicalSpeciesName !== undefined;
  const genus = (canonicalGenus ?? species.canonical_genus).trim();
  const epithet = (canonicalSpeciesName ?? species.canonical_species_name).trim();
  if (renaming) {
    if (!genus) throw new CatalogueRefusal("Canonical genus cannot be empty", "invalid");
    if (!epithet) throw new CatalogueRefusal("Canonical species name cannot be empty", "invalid");
    const holder = await findSpeciesByCanonicalName(`${genus} ${epithet}`);
    if (holder && holder.group_id !== groupId) {
      throw new CatalogueRefusal("A species with this canonical name already exists", "duplicate");
    }
  }
  if (
    speciesType !== undefined ||
    programClass !== undefined ||
    basePoints !== undefined ||
    isCaresSpecies !== undefined
  ) {
    await updateSpecies(groupId, { speciesType, programClass, pointClass: basePoints, isCaresSpecies });
  }
  if (renaming) {
    await renameCanonical(groupId, genus, epithet);
  }
  if (externalReferences !== undefined) {
    await setSpeciesExternalReferences(groupId, externalReferences);
  }
  if (imageLinks !== undefined) {
    await setSpeciesImages(groupId, imageLinks);
  }
  return 1;
}

/**
 * Delegates to `deleteSpecies` in `@/species`, which refuses while any
 * Submission references the Species. There is no force any more; `force`
 * is accepted and ignored until callers migrate.
 */
export function deleteSpeciesGroup(groupId: number, force = false): Promise<number> {
  void force;
  return deleteSpecies(groupId);
}

/** Delegates to `setPointClass` in `@/species`. */
export function bulkSetPoints(groupIds: number[], points: number | null): Promise<number> {
  return setPointClass(groupIds, points);
}

/**
 * Has any member ever had a Submission of this Species approved? Used for the
 * first-time species bonus at approval.
 */
export async function isFirstTimeSpeciesForProgram(groupId: number): Promise<{
  isFirstTime: boolean;
  priorBreedCount: number;
}> {
  const { approved } = await countSubmissionsOfSpecies(groupId);
  return { isFirstTime: approved === 0, priorBreedCount: approved };
}

/**
 * Ensure name IDs exist for a species group and submission's name strings
 * Looks up existing names in the split schema tables, creating them if they don't exist
 *
 * @param groupId - Species group ID
 * @param commonName - Common name from submission
 * @param scientificName - Scientific name from submission
 * @returns Object with common_name_id and scientific_name_id
 */
export async function ensureNameIdsForGroupId(
  groupId: number,
  commonName: string,
  scientificName: string
): Promise<{ common_name_id: number; scientific_name_id: number }> {
  // Look up common name ID
  const commonRows = await query<{ common_name_id: number }>(
    "SELECT common_name_id FROM species_common_name WHERE group_id = ? AND common_name = ?",
    [groupId, commonName]
  );

  let common_name_id = commonRows[0]?.common_name_id;

  // If not found, create it
  if (!common_name_id) {
    common_name_id = await addCommonName(groupId, commonName);
  }

  // Look up scientific name ID
  const scientificRows = await query<{ scientific_name_id: number }>(
    "SELECT scientific_name_id FROM species_scientific_name WHERE group_id = ? AND scientific_name = ?",
    [groupId, scientificName]
  );

  let scientific_name_id = scientificRows[0]?.scientific_name_id;

  // If not found, create it
  if (!scientific_name_id) {
    scientific_name_id = await addScientificName(groupId, scientificName);
  }

  return {
    common_name_id,
    scientific_name_id,
  };
}

/**
 * Type for common name search results with species details
 */
export type CommonNameWithSpecies = {
  common_name_id: number;
  group_id: number;
  common_name: string;
  canonical_genus: string;
  canonical_species_name: string;
  program_class: string;
};

/**
 * Get all common names matching exact text across all species
 * @param commonNameText - Common name to search for (exact match)
 * @param limit - Optional limit on results (default: no limit)
 * @returns Array of common names with species details
 */
export async function getCommonNamesByText(
  commonNameText: string,
  limit?: number
): Promise<CommonNameWithSpecies[]> {
  const sql = `
    SELECT
      scn.common_name_id,
      scn.group_id,
      scn.common_name,
      sng.canonical_genus,
      sng.canonical_species_name,
      sng.program_class
    FROM species_common_name scn
    JOIN species_name_group sng ON scn.group_id = sng.group_id
    WHERE scn.common_name = ?
    ORDER BY sng.canonical_genus, sng.canonical_species_name
    ${limit ? "LIMIT ?" : ""}
  `;

  const params = limit ? [commonNameText, limit] : [commonNameText];
  return query<CommonNameWithSpecies>(sql, params);
}

/**
 * Bulk delete common names by text match or by IDs
 * @param options - Either { commonName: string } or { commonNameIds: number[] }
 * @param preview - If true, return what would be deleted without deleting (default: false)
 * @returns Object with count of deletions and optional preview data
 */
export async function bulkDeleteCommonNames(
  options: { commonName: string } | { commonNameIds: number[] },
  preview = false
): Promise<{ count: number; preview?: CommonNameWithSpecies[] }> {
  try {
    // Get the list of common names to delete
    let namesToDelete: CommonNameWithSpecies[];

    if ("commonName" in options) {
      // Search by text
      namesToDelete = await getCommonNamesByText(options.commonName);
    } else {
      // Search by IDs
      if (options.commonNameIds.length === 0) {
        return { count: 0, preview: [] };
      }

      const placeholders = options.commonNameIds.map(() => "?").join(",");
      namesToDelete = await query<CommonNameWithSpecies>(
        `
        SELECT
          scn.common_name_id,
          scn.group_id,
          scn.common_name,
          sng.canonical_genus,
          sng.canonical_species_name,
          sng.program_class
        FROM species_common_name scn
        JOIN species_name_group sng ON scn.group_id = sng.group_id
        WHERE scn.common_name_id IN (${placeholders})
        ORDER BY sng.canonical_genus, sng.canonical_species_name
      `,
        options.commonNameIds
      );
    }

    // If preview mode, just return what would be deleted
    if (preview) {
      return {
        count: namesToDelete.length,
        preview: namesToDelete,
      };
    }

    // Execute deletions in a transaction
    let deletedCount = 0;
    await withTransaction(async (db) => {
      const stmt = await db.prepare("DELETE FROM species_common_name WHERE common_name_id = ?");
      try {
        for (const name of namesToDelete) {
          const result = await stmt.run(name.common_name_id);
          deletedCount += result.changes || 0;
        }
      } finally {
        await stmt.finalize();
      }
    });

    return { count: deletedCount };
  } catch (err) {
    logger.error("Failed to bulk delete common names", err);
    throw new Error("Failed to bulk delete common names");
  }
}
