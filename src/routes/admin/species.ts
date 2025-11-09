import { Response } from "express";
import { MulmRequest } from "@/sessions";
import type { Database } from "sqlite";
import {
  getSpeciesForAdmin,
  SpeciesAdminFilters,
  getSpeciesDetail,
  getSynonymsForGroup,
  getNamesForGroup,
  updateSpeciesGroup,
  deleteSpeciesGroup,
  addCommonName,
  addScientificName,
  deleteCommonName,
  deleteScientificName,
  addSynonym,
  deleteSynonym as deleteSynonymDb,
  bulkSetPoints,
  mergeSpecies,
  getSubmissionsForSpecies,
  getSubmissionSyncStats,
  syncSubmissionsForSpecies,
} from "@/db/species";
import {
  updateIucnData,
  recordIucnSync,
  createCanonicalRecommendation,
  getCanonicalRecommendations,
  acceptCanonicalRecommendation,
  rejectCanonicalRecommendation,
  RecommendationStatus,
} from "@/db/iucn";
import { IUCNClient } from "@/integrations/iucn";
import { db } from "@/db/conn";
import { getQueryString, getQueryNumber, getQueryBoolean, getBodyString } from "@/utils/request";
import { getClassOptions } from "@/forms/submission";
import { mergeSpeciesSchema } from "@/forms/speciesMerge";
import { speciesCreateForm } from "@/forms/speciesCreate";
import { getSubmissionById } from "@/db/submissions";
import { createSpeciesGroup } from "@/db/species";
import { logger } from "@/utils/logger";
import * as z from "zod";

/**
 * GET /admin/species
 * Admin species list with filters and pagination
 */
export const listSpecies = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  // Parse query parameters for filters
  const filters: SpeciesAdminFilters = {
    species_type: getQueryString(req, "species_type"),
    program_class: getQueryString(req, "species_class"),
    has_base_points: getQueryBoolean(req, "has_points"),
    is_cares_species: getQueryBoolean(req, "is_cares"),
    iucn_category: getQueryString(req, "iucn"),
    search: getQueryString(req, "search"),
  };

  const sort = (getQueryString(req, "sort") as "name" | "points" | "class") || "name";
  const page = getQueryNumber(req, "page") || 1;
  const limit = 50;
  const offset = (page - 1) * limit;

  // Get species data with synonyms
  const result = await getSpeciesForAdmin(filters, sort, limit, offset);

  // For each species, fetch their synonyms for the hovercard
  const speciesWithSynonyms = await Promise.all(
    result.species.map(async (species) => {
      const synonyms = await getSynonymsForGroup(species.group_id);
      return {
        ...species,
        synonyms,
      };
    })
  );

  // Calculate pagination
  const totalPages = Math.ceil(result.total_count / limit);

  // Get class options based on selected species type
  const selectedType = filters.species_type || "Fish";
  const classOptions = getClassOptions(selectedType);

  res.render("admin/speciesList", {
    title: "Species Management",
    species: speciesWithSynonyms,
    filters,
    sort,
    classOptions,
    speciesTypes: ["Fish", "Plant", "Invert", "Coral"],
    pagination: {
      currentPage: page,
      totalPages,
      totalCount: result.total_count,
      limit,
    },
  });
};

/**
 * GET /admin/species/:id/synonyms
 * Returns HTML fragment with synonyms for hovercard
 */
export const getSpeciesSynonyms = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const groupId = parseInt(req.params.id, 10);
  if (isNaN(groupId)) {
    res.status(400).send("Invalid species ID");
    return;
  }

  const names = await getNamesForGroup(groupId);

  // Render the hovercard content
  res.render("admin/speciesSynonymsHovercard", {
    commonNames: names.common_names,
    scientificNames: names.scientific_names,
  });
};

/**
 * GET /admin/species/:groupId/edit
 * Render edit sidebar for species (HTMX partial)
 */
export const editSpeciesSidebar = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const groupId = parseInt(req.params.groupId);
  if (!groupId) {
    res.status(400).send("Invalid species ID");
    return;
  }

  const speciesDetail = await getSpeciesDetail(groupId);

  if (!speciesDetail) {
    res.status(404).send("Species not found");
    return;
  }

  // Get split names (common and scientific separately)
  const names = await getNamesForGroup(groupId);

  // Get class options for this species type
  const { speciesTypesAndClasses } = await import("@/forms/submission");
  const classOptions = speciesTypesAndClasses[speciesDetail.species_type || "Fish"] || [];

  res.render("admin/speciesEdit", {
    title: "Edit Species",
    species: speciesDetail,
    commonNames: names.common_names,
    scientificNames: names.scientific_names,
    classOptions,
    speciesTypes: ["Fish", "Plant", "Invert", "Coral"],
    errors: new Map(),
  });
};

/**
 * PATCH /admin/species/:groupId
 * Update species group metadata
 */
export const updateSpecies = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const groupId = parseInt(req.params.groupId);
  if (!groupId) {
    res.status(400).send("Invalid species ID");
    return;
  }

  // Import form validation
  const { speciesEditForm } = await import("@/forms/speciesEdit");

  // Validate form data
  const parsed = speciesEditForm.safeParse(req.body);

  if (!parsed.success) {
    // Re-render form with errors
    const speciesDetail = await getSpeciesDetail(groupId);
    if (!speciesDetail) {
      res.status(404).send("Species not found");
      return;
    }

    const errors = new Map<string, string>();
    parsed.error.issues.forEach((issue) => {
      errors.set(String(issue.path[0]), issue.message);
    });

    res.render("admin/speciesEdit", {
      title: "Edit Species",
      species: { ...speciesDetail, ...(req.body as Record<string, unknown>) },
      errors,
    });
    return;
  }

  const {
    canonical_genus,
    canonical_species_name,
    program_class,
    base_points,
    is_cares_species,
    external_references,
    image_links,
  } = parsed.data;

  try {
    // Get current species data to check if program_class changed
    const currentSpecies = await getSpeciesDetail(groupId);
    if (!currentSpecies) {
      res.status(404).send("Species not found");
      return;
    }

    const programClassChanged = currentSpecies.program_class !== program_class;

    const changes = await updateSpeciesGroup(groupId, {
      canonicalGenus: canonical_genus,
      canonicalSpeciesName: canonical_species_name,
      programClass: program_class,
      basePoints: base_points,
      isCaresSpecies: is_cares_species,
      externalReferences: external_references,
      imageLinks: image_links,
    });

    if (changes === 0) {
      res.status(404).send("Species not found");
      return;
    }

    // If program_class changed, auto-sync all submissions for this species
    if (programClassChanged) {
      try {
        const syncedCount = await syncSubmissionsForSpecies(groupId);
        logger.info(
          `Auto-synced ${syncedCount} submissions for species ${groupId} after program_class change from "${currentSpecies.program_class}" to "${program_class}"`
        );
      } catch (syncErr) {
        logger.error(`Failed to auto-sync submissions for species ${groupId}`, syncErr);
        // Don't fail the update if sync fails - just log it
      }
    }

    // Success - redirect back to list
    res.set("HX-Redirect", "/admin/species").status(200).send();
  } catch (err) {
    // Handle errors (e.g., duplicate canonical name)
    const speciesDetail = await getSpeciesDetail(groupId);
    const errors = new Map<string, string>();

    if (err instanceof Error && err.message.includes("already exists")) {
      errors.set("canonical_genus", err.message);
    } else {
      errors.set("_general", "Failed to update species");
    }

    res.render("admin/speciesEdit", {
      title: "Edit Species",
      species: { ...speciesDetail, ...(req.body as Record<string, unknown>) },
      errors,
    });
  }
};

/**
 * DELETE /admin/species/:groupId
 * Delete species group and all synonyms
 */
export const deleteSpecies = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const groupId = parseInt(req.params.groupId);
  if (!groupId) {
    res.status(400).send("Invalid species ID");
    return;
  }

  try {
    // Check query param for force flag
    const force = req.query.force === "true";
    const changes = await deleteSpeciesGroup(groupId, force);

    if (changes === 0) {
      res.status(404).send("Species not found");
      return;
    }

    res.status(200).send("Species deleted");
  } catch (err) {
    if (err instanceof Error && err.message.includes("approved submissions")) {
      res.status(400).send(err.message);
    } else {
      res.status(500).send("Failed to delete species");
    }
  }
};

/**
 * DELETE /admin/species/:groupId/common-names/:commonNameId
 * Delete a common name
 */
export const deleteCommonNameRoute = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const commonNameId = parseInt(req.params.commonNameId);
  if (!commonNameId) {
    res.status(400).send("Invalid common name ID");
    return;
  }

  try {
    const changes = await deleteCommonName(commonNameId);

    if (changes === 0) {
      res.status(404).send("Common name not found");
      return;
    }

    // Return empty response - HTMX will remove the element
    res.status(200).send("");
  } catch {
    res.status(500).send("Failed to delete common name");
  }
};

/**
 * DELETE /admin/species/:groupId/scientific-names/:scientificNameId
 * Delete a scientific name
 */
export const deleteScientificNameRoute = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const scientificNameId = parseInt(req.params.scientificNameId);
  if (!scientificNameId) {
    res.status(400).send("Invalid scientific name ID");
    return;
  }

  try {
    const changes = await deleteScientificName(scientificNameId);

    if (changes === 0) {
      res.status(404).send("Scientific name not found");
      return;
    }

    // Return empty response - HTMX will remove the element
    res.status(200).send("");
  } catch {
    res.status(500).send("Failed to delete scientific name");
  }
};

/**
 * DEPRECATED: DELETE /admin/species/:groupId/synonyms/:nameId
 * Delete a synonym (old paired table)
 */
export const deleteSynonym = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const nameId = parseInt(req.params.nameId);
  if (!nameId) {
    res.status(400).send("Invalid synonym ID");
    return;
  }

  try {
    const force = req.query.force === "true";
    const changes = await deleteSynonymDb(nameId, force);

    if (changes === 0) {
      res.status(404).send("Synonym not found");
      return;
    }

    res.status(200).send("Synonym deleted");
  } catch (err) {
    if (err instanceof Error && err.message.includes("last synonym")) {
      res.status(400).send(err.message);
    } else {
      res.status(500).send("Failed to delete synonym");
    }
  }
};

/**
 * POST /admin/species/:groupId/common-names
 * Add a new common name
 */
export const addCommonNameRoute = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const groupId = parseInt(req.params.groupId);
  if (!groupId) {
    res.status(400).send("Invalid species ID");
    return;
  }

  const common_name = getBodyString(req, "common_name");

  try {
    const commonNameId = await addCommonName(groupId, common_name);

    // Return HTML for new common name row
    res.render("admin/commonNameRow", {
      name: {
        common_name_id: commonNameId,
        common_name: common_name.trim(),
      },
      groupId,
    });
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).send(err.message);
    } else {
      res.status(500).send("Failed to add common name");
    }
  }
};

/**
 * POST /admin/species/:groupId/scientific-names
 * Add a new scientific name
 */
export const addScientificNameRoute = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const groupId = parseInt(req.params.groupId);
  if (!groupId) {
    res.status(400).send("Invalid species ID");
    return;
  }

  const scientific_name = getBodyString(req, "scientific_name");

  try {
    const scientificNameId = await addScientificName(groupId, scientific_name);

    // Return HTML for new scientific name row
    res.render("admin/scientificNameRow", {
      name: {
        scientific_name_id: scientificNameId,
        scientific_name: scientific_name.trim(),
      },
      groupId,
    });
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).send(err.message);
    } else {
      res.status(500).send("Failed to add scientific name");
    }
  }
};

/**
 * GET /admin/species/:groupId/common-names/new
 * Render add common name form (HTMX partial)
 */
export const addCommonNameForm = (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const groupId = parseInt(req.params.groupId);

  res.render("admin/addCommonNameForm", { groupId });
};

/**
 * GET /admin/species/:groupId/scientific-names/new
 * Render add scientific name form (HTMX partial)
 */
export const addScientificNameForm = (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const groupId = parseInt(req.params.groupId);

  res.render("admin/addScientificNameForm", { groupId });
};

/**
 * DEPRECATED: POST /admin/species/:groupId/synonyms
 * Add a new paired synonym (old schema)
 */
export const addSynonymRoute = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const groupId = parseInt(req.params.groupId);
  if (!groupId) {
    res.status(400).send("Invalid species ID");
    return;
  }

  const common_name = getBodyString(req, "common_name");
  const scientific_name = getBodyString(req, "scientific_name");

  try {
    const nameId = await addSynonym(groupId, common_name, scientific_name);

    // Return the new synonym HTML to be appended
    res.render("admin/synonymRow", {
      synonym: {
        name_id: nameId,
        common_name: common_name.trim(),
        scientific_name: scientific_name.trim(),
      },
      groupId,
    });
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).send(err.message);
    } else {
      res.status(500).send("Failed to add synonym");
    }
  }
};

/**
 * GET /admin/species/:groupId/synonyms/new
 * Render add synonym form (HTMX partial)
 */
export const addSynonymForm = (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const groupId = parseInt(req.params.groupId);

  res.render("admin/addSynonymForm", {
    groupId,
    errors: new Map(),
  });
};

/**
 * GET /admin/dialog/species/bulk-set-points
 * Render bulk set points dialog (HTMX partial)
 */
export const bulkSetPointsDialog = (req: MulmRequest, res: Response) => {
  res.render("admin/bulkSetPointsDialog");
};

// Schema for bulk set points form
const bulkSetPointsSchema = z.object({
  groupIds: z.union([
    z.string().transform((val) => val.split(",").map((id) => parseInt(id.trim()))),
    z.array(z.string()).transform((arr) => arr.map((id) => parseInt(id))),
  ]),
  base_points: z
    .string()
    .transform((val) => (val === "" ? null : parseInt(val)))
    .refine((val) => val === null || (val >= 0 && val <= 100), {
      message: "Points must be between 0 and 100",
    }),
});

/**
 * POST /admin/species/bulk-set-points
 * Bulk update base points for selected species
 */
export const bulkSetPointsAction = async (req: MulmRequest, res: Response) => {
  const parsed = bulkSetPointsSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).send(parsed.error.issues[0].message);
    return;
  }

  const { groupIds, base_points } = parsed.data;

  if (groupIds.length === 0) {
    res.status(400).send("No species selected");
    return;
  }

  try {
    await bulkSetPoints(groupIds, base_points);

    // Success - close dialog and reload page
    res.set("HX-Redirect", "/admin/species").status(200).send();
  } catch {
    res.status(500).send("Failed to update species points");
  }
};

/**
 * GET /admin/dialog/species/:groupId/merge
 * Render merge species dialog (HTMX partial)
 */
export const mergeSpeciesDialog = async (req: MulmRequest, res: Response) => {
  const groupId = parseInt(req.params.groupId);

  if (!groupId) {
    res.status(400).send("Invalid species ID");
    return;
  }

  const defunctSpecies = await getSpeciesDetail(groupId);

  if (!defunctSpecies) {
    res.status(404).send("Species not found");
    return;
  }

  const defunctNames = await getNamesForGroup(groupId);

  res.render("admin/mergeSpeciesDialog", {
    defunctSpecies,
    defunctNames,
  });
};

/**
 * POST /admin/species/:groupId/merge
 * Merge defunct species into canonical species
 */
export const mergeSpeciesAction = async (req: MulmRequest, res: Response) => {
  const parsed = mergeSpeciesSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).send(parsed.error.issues[0].message);
    return;
  }

  const { defunct_group_id, canonical_group_id } = parsed.data;

  // Verify both species exist
  const [defunctSpecies, canonicalSpecies] = await Promise.all([
    getSpeciesDetail(defunct_group_id),
    getSpeciesDetail(canonical_group_id),
  ]);

  if (!defunctSpecies) {
    res.status(404).send("Defunct species not found");
    return;
  }

  if (!canonicalSpecies) {
    res.status(404).send("Canonical species not found");
    return;
  }

  try {
    await mergeSpecies(canonical_group_id, defunct_group_id);

    // Success - redirect to canonical species edit page
    res.set("HX-Redirect", `/admin/species/${canonical_group_id}/edit`).status(200).send();
  } catch {
    res.status(500).send("Failed to merge species");
  }
};

/**
 * GET /admin/dialog/species/new?submission_id=123
 * Render create species dialog with pre-filled data from submission
 */
export const createSpeciesDialog = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const submissionId = parseInt(req.query.submission_id as string);
  if (!submissionId) {
    res.status(400).send("Invalid submission ID");
    return;
  }

  const submission = await getSubmissionById(submissionId);

  if (!submission) {
    res.status(404).send("Submission not found");
    return;
  }

  // Parse scientific name into genus and species
  // Expected format: "Genus species" (binomial nomenclature)
  const latinName = submission.species_latin_name || "";
  const parts = latinName.trim().split(/\s+/);
  const canonical_genus = parts[0] || "";
  const canonical_species_name = parts[1] || "";

  // Get class options for this species type
  const classOptions = getClassOptions(submission.species_type || "Fish");

  res.render("admin/createSpeciesDialog", {
    submission,
    prefilled: {
      canonical_genus,
      canonical_species_name,
      program_class: submission.species_class || "",
    },
    classOptions,
    errors: new Map(),
  });
};

/**
 * POST /admin/species
 * Create a new species group
 */
export const createSpeciesRoute = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  // Validate form data
  const parsed = speciesCreateForm.safeParse(req.body);

  if (!parsed.success) {
    const errors = new Map<string, string>();
    parsed.error.issues.forEach((issue) => {
      errors.set(String(issue.path[0]), issue.message);
    });

    // Return errors as JSON for HTMX to handle
    res.status(400).json({
      success: false,
      errors: Object.fromEntries(errors),
    });
    return;
  }

  const {
    canonical_genus,
    canonical_species_name,
    program_class,
    species_type,
    base_points,
    is_cares_species,
  } = parsed.data;

  try {
    const groupId = await createSpeciesGroup({
      canonicalGenus: canonical_genus,
      canonicalSpeciesName: canonical_species_name,
      programClass: program_class,
      speciesType: species_type,
      basePoints: base_points,
      isCaresSpecies: is_cares_species,
    });

    const canonicalName = `${canonical_genus} ${canonical_species_name}`;

    // Return JSON with the new group_id for HTMX event handling
    res.status(200).json({
      success: true,
      group_id: groupId,
      canonical_name: canonicalName,
    });
  } catch (err) {
    // Handle errors (e.g., duplicate canonical name)
    if (err instanceof Error && err.message.includes("already exists")) {
      res.status(400).json({
        success: false,
        errors: {
          canonical_genus: err.message,
        },
      });
    } else {
      res.status(500).json({
        success: false,
        errors: {
          _general: "Failed to create species",
        },
      });
    }
  }
};

// Schema for bulk IUCN sync
const bulkSyncIucnSchema = z.object({
  groupIds: z.union([
    z.string().transform((val) => val.split(",").map((id) => parseInt(id.trim()))),
    z.array(z.string()).transform((arr) => arr.map((id) => parseInt(id))),
  ]),
});

/**
 * POST /admin/species/bulk-sync-iucn
 * Bulk sync IUCN data for selected species
 */
export const bulkSyncIucn = async (req: MulmRequest, res: Response) => {
  const parsed = bulkSyncIucnSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).send(parsed.error.issues[0]?.message ?? "Invalid request");
    return;
  }

  const { groupIds } = parsed.data;

  if (groupIds.length === 0) {
    res.status(400).send("No species selected");
    return;
  }

  try {
    const database = db(true);
    const iucnClient = new IUCNClient();

    // Test API connection first
    const connectionOk = await iucnClient.testConnection();
    if (!connectionOk) {
      res.status(503).send("IUCN API is not accessible. Please try again later.");
      return;
    }

    // Get species data for selected IDs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const speciesData: any[] = await database.all(
      `SELECT group_id, canonical_genus, canonical_species_name
       FROM species_name_group
       WHERE group_id IN (${groupIds.map(() => "?").join(",")})`,
      ...groupIds
    );

    let successCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;
    let synonymsFound = 0;

    // Sync each species
    for (const species of speciesData as Array<{
      group_id: number;
      canonical_genus: string;
      canonical_species_name: string;
    }>) {
      try {
        const scientificName = `${species.canonical_genus} ${species.canonical_species_name}`;
        const result = await iucnClient.getSpeciesByName(scientificName);

        if (result) {
          await updateIucnData(database, species.group_id, {
            category: result.category,
            taxonId: result.taxonid,
            populationTrend: result.population_trend || undefined,
            url: result.url,
          });
          await recordIucnSync(database, species.group_id, "success", {
            category: result.category,
            taxonId: result.taxonid,
            populationTrend: result.population_trend || undefined,
            url: result.url,
          });
          successCount++;

          // Check for synonym/name mismatch
          const genusDiffers = result.genus.toLowerCase() !== species.canonical_genus.toLowerCase();
          const speciesDiffers =
            result.scientific_name.split(" ")[1]?.toLowerCase() !==
            species.canonical_species_name.toLowerCase();

          if (genusDiffers || speciesDiffers) {
            const suggestedSpecies =
              result.scientific_name.split(" ")[1] || species.canonical_species_name;

            try {
              await createCanonicalRecommendation(database, {
                groupId: species.group_id,
                currentGenus: species.canonical_genus,
                currentSpecies: species.canonical_species_name,
                suggestedGenus: result.genus,
                suggestedSpecies: suggestedSpecies,
                iucnTaxonId: result.taxonid,
                iucnUrl: result.url,
                reason: genusDiffers
                  ? "IUCN accepted name differs (genus changed)"
                  : "IUCN accepted name differs (species epithet changed)",
              });
              synonymsFound++;
            } catch (err) {
              // Ignore duplicate recommendations
              if (!(err instanceof Error && err.message.includes("already exists"))) {
                logger.warn(`Failed to create canonical recommendation for ${scientificName}`, err);
              }
            }
          }
        } else {
          await recordIucnSync(database, species.group_id, "not_found");
          notFoundCount++;
        }
      } catch (error) {
        logger.error(
          `IUCN sync failed for ${species.canonical_genus} ${species.canonical_species_name}`,
          error
        );
        await recordIucnSync(
          database,
          species.group_id,
          "api_error",
          undefined,
          error instanceof Error ? error.message : "Unknown error"
        );
        errorCount++;
      }
    }

    // Return success message as HTML with auto-reload
    const synonymMessage =
      synonymsFound > 0
        ? ` <span class="text-amber-700 font-medium">${synonymsFound} name difference(s) detected - recommendations created for review.</span>`
        : "";
    const resultHtml = `
      <div class="bg-green-50 border-l-4 border-green-400 p-4 mb-4 rounded-lg">
        <div class="flex items-start gap-3">
          <svg class="w-6 h-6 text-green-600 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <h3 class="text-base font-semibold text-green-800">IUCN Sync Complete</h3>
            <p class="text-sm text-green-700 mt-1">
              Processed ${groupIds.length} species: ${successCount} successful, ${notFoundCount} not found, ${errorCount} errors.${synonymMessage}
            </p>
          </div>
        </div>
      </div>
    `;

    // If single species sync, trigger page reload after short delay to show updated data
    if (groupIds.length === 1) {
      res.set("HX-Trigger-After-Swap", "pageReload").send(resultHtml);
    } else {
      // For bulk sync, show message with manual reload button
      const bulkResultHtml = resultHtml.replace(
        "</p>",
        '<button class="text-blue-600 hover:text-blue-800 underline ml-2" onclick="window.location.reload()">Refresh page to see updated data</button></p>'
      );
      res.send(bulkResultHtml);
    }
  } catch (error) {
    logger.error("Bulk IUCN sync failed", error);
    res.status(500).send("Sync operation failed. Please check logs.");
  }
};

/**
 * GET /admin/species/canonical-recommendations
 * Display IUCN canonical name recommendations with filters
 */
export const listCanonicalRecommendations = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const statusFilter = getQueryString(req, "status") as RecommendationStatus | undefined;

  const database = db(true);

  try {
    // Get recommendations with optional status filter
    const recommendations = await getCanonicalRecommendations(database, {
      status: statusFilter,
    });

    // For each recommendation, get the current species details
    const recommendationsWithSpecies = await Promise.all(
      recommendations.map(async (rec) => {
        const species = await getSpeciesDetail(rec.group_id);
        return {
          ...rec,
          species,
        };
      })
    );

    res.render("admin/canonicalRecommendations", {
      title: "IUCN Taxonomic Name Recommendations",
      recommendations: recommendationsWithSpecies,
      statusFilter,
    });
  } catch (error) {
    logger.error("Failed to load canonical recommendations", error);
    res.status(500).send("Failed to load recommendations");
  }
};

/**
 * POST /admin/species/canonical-recommendations/:id/accept
 * Accept a canonical name recommendation and apply the change
 */
export const acceptCanonicalRecommendationRoute = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const recommendationId = parseInt(req.params.id);
  if (!recommendationId) {
    res.status(400).send("Invalid recommendation ID");
    return;
  }

  const database = db(true);

  try {
    await acceptCanonicalRecommendation(database, recommendationId, viewer.id);

    // Success - redirect back to the list
    res.set("HX-Redirect", "/admin/species/canonical-recommendations").status(200).send();
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).send(err.message);
    } else {
      res.status(500).send("Failed to accept recommendation");
    }
  }
};

/**
 * POST /admin/species/canonical-recommendations/:id/reject
 * Reject a canonical name recommendation
 */
export const rejectCanonicalRecommendationRoute = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const recommendationId = parseInt(req.params.id);
  if (!recommendationId) {
    res.status(400).send("Invalid recommendation ID");
    return;
  }

  const database = db(true);

  try {
    await rejectCanonicalRecommendation(database, recommendationId, viewer.id);

    // Success - redirect back to the list
    res.set("HX-Redirect", "/admin/species/canonical-recommendations").status(200).send();
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).send(err.message);
    } else {
      res.status(500).send("Failed to reject recommendation");
    }
  }
};

/**
 * POST /admin/species/sync-all-iucn
 * Sync IUCN data for all species that haven't been synced in 30 days
 * This is a long-running operation that processes species in batches
 */
export const syncAllIucnData = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const database = db(true);
  const iucnClient = new IUCNClient();

  try {
    // Test API connection first
    const connectionOk = await iucnClient.testConnection();
    if (!connectionOk) {
      res.status(503).send("IUCN API is not accessible. Please try again later.");
      return;
    }

    // Get species that need syncing (haven't been synced in 30 days or never synced)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoISO = thirtyDaysAgo.toISOString();

    interface SpeciesForSync {
      group_id: number;
      canonical_genus: string;
      canonical_species_name: string;
      iucn_last_updated: string | null;
    }

    const speciesToSync = await database.all<SpeciesForSync[]>(
      `SELECT group_id, canonical_genus, canonical_species_name, iucn_last_updated
       FROM species_name_group
       WHERE species_type = 'Fish'
         AND (iucn_last_updated IS NULL OR iucn_last_updated < ?)
       ORDER BY iucn_last_updated ASC NULLS FIRST
       LIMIT 100`,
      [thirtyDaysAgoISO]
    );

    if (speciesToSync.length === 0) {
      res.send(`
        <div class="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-lg">
          <p class="text-sm text-blue-700">All species are up to date! No sync needed.</p>
        </div>
      `);
      return;
    }

    // Queue ALL species for background processing to avoid HTTP timeout
    // Fire and forget - process in background
    processRemainingBatches(speciesToSync, database, iucnClient).catch((err) => {
      logger.error("Background IUCN sync failed", err);
    });

    const resultHtml = `
      <div class="bg-green-50 border-l-4 border-green-400 p-4 rounded-lg">
        <div class="flex items-start gap-3">
          <svg class="w-6 h-6 text-green-600 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <h3 class="text-base font-semibold text-green-800">IUCN Sync Queued</h3>
            <p class="text-sm text-green-700 mt-1">
              <span class="font-semibold">${speciesToSync.length} species</span> have been queued for IUCN sync.
              Processing in batches of 5 with 2-second delays between batches.
              This will take approximately <span class="font-semibold">${Math.ceil((speciesToSync.length / 5) * 2 / 60)} minutes</span>.
            </p>
            <p class="text-sm text-green-700 mt-2">
              <span class="text-blue-600">Processing is happening in the background.</span>
              Refresh this page in a few minutes to see updated data and any new recommendations.
            </p>
            <button class="text-blue-600 hover:text-blue-800 underline text-sm mt-2" onclick="window.location.reload()">Refresh page now</button>
          </div>
        </div>
      </div>
    `;

    res.send(resultHtml);
  } catch (error) {
    logger.error("Bulk IUCN sync failed", error);
    res.status(500).send("Sync operation failed. Please check logs.");
  }
};

/**
 * Process remaining IUCN sync batches in the background
 */
async function processRemainingBatches(
  species: Array<{ group_id: number; canonical_genus: string; canonical_species_name: string }>,
  database: Database,
  iucnClient: IUCNClient
) {
  const batchSize = 5;
  const rateLimitMs = 2000; // 2 seconds between batches

  for (let i = 0; i < species.length; i += batchSize) {
    const batch = species.slice(i, i + batchSize);

    for (const sp of batch) {
      try {
        const scientificName = `${sp.canonical_genus} ${sp.canonical_species_name}`;
        const result = await iucnClient.getSpeciesByName(scientificName);

        if (result) {
          await updateIucnData(database, sp.group_id, {
            category: result.category,
            taxonId: result.taxonid,
            populationTrend: result.population_trend || undefined,
            url: result.url,
          });
          await recordIucnSync(database, sp.group_id, "success", {
            category: result.category,
            taxonId: result.taxonid,
            populationTrend: result.population_trend || undefined,
            url: result.url,
          });

          // Check for name differences
          const genusDiffers = result.genus.toLowerCase() !== sp.canonical_genus.toLowerCase();
          const speciesDiffers =
            result.scientific_name.split(" ")[1]?.toLowerCase() !== sp.canonical_species_name.toLowerCase();

          if (genusDiffers || speciesDiffers) {
            const suggestedSpecies = result.scientific_name.split(" ")[1] || sp.canonical_species_name;
            try {
              await createCanonicalRecommendation(database, {
                groupId: sp.group_id,
                currentGenus: sp.canonical_genus,
                currentSpecies: sp.canonical_species_name,
                suggestedGenus: result.genus,
                suggestedSpecies: suggestedSpecies,
                iucnTaxonId: result.taxonid,
                iucnUrl: result.url,
                reason: genusDiffers
                  ? "IUCN accepted name differs (genus changed)"
                  : "IUCN accepted name differs (species epithet changed)",
              });
            } catch (err) {
              if (!(err instanceof Error && err.message.includes("already exists"))) {
                logger.warn(`Failed to create canonical recommendation for ${scientificName}`, err);
              }
            }
          }
        } else {
          // Not found - still update timestamp
          await updateIucnData(database, sp.group_id, {
            category: "NE",
            taxonId: undefined,
            populationTrend: undefined,
            url: undefined,
          });
          await recordIucnSync(database, sp.group_id, "not_found");
        }
      } catch (error) {
        logger.error(`Background IUCN sync failed for ${sp.canonical_genus} ${sp.canonical_species_name}`, error);
        await recordIucnSync(
          database,
          sp.group_id,
          "api_error",
          undefined,
          error instanceof Error ? error.message : "Unknown error"
        );
      }
    }

    // Rate limit between batches
    if (i + batchSize < species.length) {
      await new Promise((resolve) => setTimeout(resolve, rateLimitMs));
    }
  }

  logger.info(`Background IUCN sync completed for ${species.length} species`);
}

/**
 * GET /admin/species/:groupId/submissions
 * Get submissions for a species (for display on edit page)
 */
export const getSubmissions = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const groupId = parseInt(req.params.groupId);
  if (!groupId) {
    res.status(400).send("Invalid species ID");
    return;
  }

  try {
    const [submissions, stats] = await Promise.all([
      getSubmissionsForSpecies(groupId),
      getSubmissionSyncStats(groupId),
    ]);

    res.render("admin/speciesSubmissions", {
      submissions,
      stats,
      groupId,
    });
  } catch (err) {
    logger.error(`Failed to get submissions for species ${groupId}`, err);
    res.status(500).send("Failed to load submissions");
  }
};

/**
 * POST /admin/species/:groupId/sync-submissions
 * Manually sync submissions for a species
 */
export const syncSubmissions = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send("Admin access required");
    return;
  }

  const groupId = parseInt(req.params.groupId);
  if (!groupId) {
    res.status(400).send("Invalid species ID");
    return;
  }

  try {
    const syncedCount = await syncSubmissionsForSpecies(groupId);

    // Return updated stats and submissions
    const [submissions, stats] = await Promise.all([
      getSubmissionsForSpecies(groupId),
      getSubmissionSyncStats(groupId),
    ]);

    res.render("admin/speciesSubmissions", {
      submissions,
      stats,
      groupId,
      syncMessage: `Successfully synced ${syncedCount} submission${syncedCount !== 1 ? "s" : ""}`,
    });
  } catch (err) {
    logger.error(`Failed to sync submissions for species ${groupId}`, err);
    res.status(500).send("Failed to sync submissions");
  }
};
