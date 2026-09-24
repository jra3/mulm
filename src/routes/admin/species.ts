import { Response } from "express";
import { MulmRequest } from "@/sessions";
import type { Database } from "sqlite";
import * as catalogue from "@/species";
import { CatalogueRefusal, type RefusalCode, type SpeciesAdminFilters } from "@/species";
import { setSpeciesExternalReferences, setSpeciesImages } from "@/db/speciesEnrichment";
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
import { getClassOptions, speciesTypesAndClasses } from "@/forms/submission";
import { speciesEditForm } from "@/forms/speciesEdit";
import { pointClassField } from "@/forms/pointClass";
import { mergeSpeciesSchema } from "@/forms/speciesMerge";
import { speciesCreateForm } from "@/forms/speciesCreate";
import { getSubmissionById, type Submission } from "@/db/submissions";
import * as lifecycle from "@/lifecycle";
import { callerFor } from "../lifecycleErrors";
import { allowedMoves, validateSubmission } from "../submission";
import { logger } from "@/utils/logger";
import * as z from "zod";

const refusalStatus: Record<RefusalCode, number> = {
  not_found: 404,
  invalid: 400,
  point_class: 400,
  duplicate: 409,
  referenced: 409,
  canonical: 409,
};

/** The form field a refusal belongs to: a taken Canonical name is the genus field's. */
function refusalField(err: CatalogueRefusal): string {
  return err.code === "duplicate" ? "canonical_genus" : "_general";
}

/**
 * Send a catalogue refusal as a 4xx carrying its message. Matches on the
 * class and its code, never on message text.
 * @returns true if `err` was a refusal and a response was sent
 */
function sendRefusal(res: Response, err: unknown): boolean {
  if (!(err instanceof CatalogueRefusal)) return false;
  res.status(refusalStatus[err.code]).send(err.message);
  return true;
}

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

  // Each row carries its Names of both kinds for the hovercard
  const result = await catalogue.getSpeciesForAdmin(filters, sort, limit, offset);

  // Calculate pagination
  const totalPages = Math.ceil(result.total_count / limit);

  // Get class options based on selected species type
  const selectedType = filters.species_type || "Fish";
  const classOptions = getClassOptions(selectedType);

  res.render("admin/speciesList", {
    title: "Species Management",
    species: result.species,
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

  const speciesDetail = await catalogue.getSpeciesDetail(groupId);

  if (!speciesDetail) {
    res.status(404).send("Species not found");
    return;
  }

  const names = speciesDetail.names;

  // Get class options for this species type
  const classOptions = speciesTypesAndClasses[speciesDetail.species_type || "Fish"] || [];

  res.render("admin/speciesEdit", {
    title: "Edit Species",
    species: speciesDetail,
    commonNames: names.common,
    scientificNames: names.scientific,
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

  // Validate form data
  const parsed = speciesEditForm.safeParse(req.body);

  // A refusal is a 4xx whose text the form shows under Save Changes; only a
  // successful save leaves the page.
  if (!parsed.success) {
    res.status(400).send(parsed.error.issues.map((issue) => issue.message).join(". "));
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
    // The rename goes first: its refusals (a missing Species, a Canonical
    // name another Species holds) come before it writes anything, and the
    // form has already validated what `updateSpecies` would refuse.
    await catalogue.renameCanonical(groupId, canonical_genus, canonical_species_name);
    await catalogue.updateSpecies(groupId, {
      programClass: program_class,
      pointClass: base_points,
      isCaresSpecies: is_cares_species,
    });
    await setSpeciesExternalReferences(groupId, external_references);
    await setSpeciesImages(groupId, image_links);

    // Success - redirect back to list
    res.set("HX-Redirect", "/admin/species").status(200).send();
  } catch (err) {
    if (sendRefusal(res, err)) return;
    logger.error("Failed to update species", err);
    res.status(500).send("Failed to update species");
  }
};

/**
 * DELETE /admin/species/:groupId
 * Delete a Species and its Names. Refused while any Submission references it;
 * the refusal tells the admin to merge instead.
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
    await catalogue.deleteSpecies(groupId);
    res.status(200).send("Species deleted");
  } catch (err) {
    if (sendRefusal(res, err)) return;
    logger.error("Failed to delete species", err);
    res.status(500).send("Failed to delete species");
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
    const changes = await catalogue.removeName("common", commonNameId);

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
    const changes = await catalogue.removeName("scientific", scientificNameId);

    if (changes === 0) {
      res.status(404).send("Scientific name not found");
      return;
    }

    // Return empty response - HTMX will remove the element
    res.status(200).send("");
  } catch (err) {
    if (sendRefusal(res, err)) return;
    logger.error("Failed to delete scientific name", err);
    res.status(500).send("Failed to delete scientific name");
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
    const nameId = await catalogue.addName(groupId, "common", common_name);

    // Return HTML for new common name row
    res.render("admin/commonNameRow", {
      name: { name_id: nameId, name: common_name.trim() },
      groupId,
    });
  } catch (err) {
    if (sendRefusal(res, err)) return;
    logger.error("Failed to add common name", err);
    res.status(500).send("Failed to add common name");
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
    const nameId = await catalogue.addName(groupId, "scientific", scientific_name);

    // Return HTML for new scientific name row
    res.render("admin/scientificNameRow", {
      name: { name_id: nameId, name: scientific_name.trim() },
      groupId,
    });
  } catch (err) {
    if (sendRefusal(res, err)) return;
    logger.error("Failed to add scientific name", err);
    res.status(500).send("Failed to add scientific name");
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
  base_points: pointClassField,
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
    await catalogue.setPointClass(groupIds, base_points);

    // Success - close dialog and reload page
    res.set("HX-Redirect", "/admin/species").status(200).send();
  } catch (err) {
    if (sendRefusal(res, err)) return;
    logger.error("Failed to set Point class", err);
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

  const defunctSpecies = await catalogue.getSpeciesDetail(groupId);

  if (!defunctSpecies) {
    res.status(404).send("Species not found");
    return;
  }

  const defunctNames = defunctSpecies.names;

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
    catalogue.getSpeciesDetail(defunct_group_id),
    catalogue.getSpeciesDetail(canonical_group_id),
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
    await catalogue.mergeSpecies(canonical_group_id, defunct_group_id);

    // Success - redirect to canonical species edit page
    res.set("HX-Redirect", `/admin/species/${canonical_group_id}/edit`).status(200).send();
  } catch (err) {
    if (sendRefusal(res, err)) return;
    logger.error("Failed to merge species", err);
    res.status(500).send("Failed to merge species");
  }
};

type CreateSpeciesDialogValues = {
  canonical_genus: string;
  canonical_species_name: string;
  program_class: string;
};

/** The create-Species dialog, for the witness panel's Submission. */
function renderCreateSpeciesDialog(
  res: Response,
  submission: Submission,
  prefilled: CreateSpeciesDialogValues,
  errors: Map<string, string>
) {
  res.render("admin/createSpeciesDialog", {
    submission,
    prefilled,
    classOptions: getClassOptions(submission.species_type || "Fish"),
    errors,
  });
}

/**
 * GET /admin/dialog/species/new?submission_id=123
 * The witness panel's create-Species dialog, pre-filled from the Submission.
 */
export const createSpeciesDialog = async (req: MulmRequest, res: Response) => {
  const submissionId = parseInt(getQueryString(req, "submission_id", ""));
  if (!submissionId) {
    res.status(400).send("Invalid submission ID");
    return;
  }

  const submission = await getSubmissionById(submissionId);
  if (!submission) {
    res.status(404).send("Submission not found");
    return;
  }

  // Genus, then the rest as the epithet, from the member's Latin spelling
  const [canonical_genus = "", ...rest] = (submission.species_latin_name || "").trim().split(/\s+/);

  renderCreateSpeciesDialog(
    res,
    submission,
    {
      canonical_genus,
      canonical_species_name: rest.join(" "),
      program_class: submission.species_class || "",
    },
    new Map()
  );
};

/**
 * POST /admin/submissions/:id/species
 * Create a Species from the witness panel and bind the Submission to it, in
 * one flow: the dialog's success is the binding. A refusal re-renders the
 * dialog with its errors; success reloads the page to show the Submission
 * bound.
 */
export const createSpeciesAndBind = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }

  const text = (key: string) => getBodyString(req, key);
  const showErrors = (errors: Map<string, string>) => {
    res.set("HX-Retarget", "#dialog").set("HX-Reswap", "outerHTML");
    renderCreateSpeciesDialog(
      res,
      submission,
      {
        canonical_genus: text("canonical_genus"),
        canonical_species_name: text("canonical_species_name"),
        program_class: text("program_class"),
      },
      errors
    );
  };

  const parsed = speciesCreateForm.safeParse(req.body);
  if (!parsed.success) {
    showErrors(new Map(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
    return;
  }

  // Ask the table before creating anything, so a refused bind leaves no
  // Species behind. bindSpecies guards again below.
  if (!allowedMoves(req.viewer, submission, lifecycle.deriveState(submission)).bindSpecies) {
    showErrors(new Map([["_general", "This Submission cannot be bound to a Species by you now."]]));
    return;
  }

  const { canonical_genus, canonical_species_name, program_class, species_type, base_points, is_cares_species } =
    parsed.data;

  let speciesId: number;
  try {
    speciesId = await catalogue.createSpecies({
      canonicalGenus: canonical_genus,
      canonicalSpeciesName: canonical_species_name,
      programClass: program_class,
      speciesType: species_type,
      pointClass: base_points,
      isCaresSpecies: is_cares_species,
    });
  } catch (err) {
    if (err instanceof CatalogueRefusal) {
      showErrors(new Map([[refusalField(err), err.message]]));
      return;
    }
    throw err;
  }

  try {
    await lifecycle.bindSpecies(callerFor(req.viewer!), submission.id, speciesId);
  } catch (err) {
    if (lifecycle.isLifecycleError(err)) {
      logger.warn(`Created Species ${speciesId} but could not bind it: ${err.message}`, {
        submissionId: submission.id,
      });
      showErrors(
        new Map([["_general", `The Species was created, but the Submission was not bound to it: ${err.message}`]])
      );
      return;
    }
    throw err;
  }

  res.set("HX-Refresh", "true").send();
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

    const speciesData = await catalogue.findSpeciesByIds(groupIds);

    let successCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;
    let nameDifferencesFound = 0;

    // Sync each species
    for (const species of speciesData) {
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

          // Check whether IUCN knows the Species under a different name
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
              nameDifferencesFound++;
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
    const nameDifferenceMessage =
      nameDifferencesFound > 0
        ? ` <span class="text-amber-700 font-medium">${nameDifferencesFound} name difference(s) detected - recommendations created for review.</span>`
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
              Processed ${groupIds.length} species: ${successCount} successful, ${notFoundCount} not found, ${errorCount} errors.${nameDifferenceMessage}
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
        const species = await catalogue.getSpeciesDetail(rec.group_id);
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

    const speciesToSync = await catalogue.listSpeciesDueIucnSync("Fish", thirtyDaysAgo, 100);

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
