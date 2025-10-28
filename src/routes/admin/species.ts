import { Response } from "express";
import { MulmRequest } from "@/sessions";
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
} from "@/db/species";
import { updateIucnData, recordIucnSync, createCanonicalRecommendation } from "@/db/iucn";
import { IUCNClient } from "@/integrations/iucn";
import { db } from "@/db/conn";
import { getQueryString, getQueryNumber, getQueryBoolean, getBodyString } from "@/utils/request";
import { getClassOptions } from "@/forms/submission";
import { mergeSpeciesSchema } from "@/forms/speciesMerge";
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
