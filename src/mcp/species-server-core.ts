/**
 * Species Database MCP Server - Core Logic
 *
 * Provides reusable server initialization for both stdio and HTTP transports.
 * This module exports the server setup function that can be used by different transport layers.
 */

import { z } from "zod";
import { defineTool, registerTools, positiveId } from "./tools";

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { db } from "../db/conn";
import { logger } from "../utils/logger";
import * as catalogue from "../species";
import {
  admitPointClass,
  canonicalName,
  type NameKind,
  type Species,
  type SpeciesAdminFilters,
  type SpeciesAdminListItem,
  updateIucnStatus,
} from "../species";
import {
  getSpeciesExternalReferences,
  getSpeciesImages,
  setSpeciesExternalReferences,
  setSpeciesImages,
} from "../db/speciesEnrichment";
import {
  recordIucnSync,
  getIucnSyncLog,
  getSpeciesWithMissingIucn,
  getSpeciesNeedingResync,
  getIucnSyncStats,
  getCanonicalRecommendations,
  acceptCanonicalRecommendation,
  rejectCanonicalRecommendation,
  type IUCNData,
  type SyncStatus,
} from "../db/iucn";
import { getIUCNClient } from "../integrations/iucn";

const createSpeciesGroupSchema = z.object({
  program_class: z.string().describe("BAP program class (e.g., Cichlids, Livebearers)"),
  canonical_genus: z.string().describe("Official genus name"),
  canonical_species_name: z.string().describe("Official species name"),
  species_type: z.enum(catalogue.speciesTypes).describe("High-level category"),
  base_points: z
    .literal(catalogue.pointClasses)
    .describe("Point class: 5, 10, 15 or 20 (optional; anything else is refused)")
    .optional(),
  is_cares_species: z
    .boolean()
    .describe("CARES conservation species (optional, default: false)")
    .optional(),
});

const updateSpeciesGroupSchema = z.object({
  group_id: positiveId.describe("Species group ID"),
  program_class: z
    .string()
    .describe("BAP program class (e.g., Cichlids, Livebearers, Killifish)")
    .optional(),
  base_points: z
    .literal(catalogue.pointClasses)
    .nullable()
    .describe("Point class: 5, 10, 15, 20, or null to unset (anything else is refused)")
    .optional(),
  is_cares_species: z.boolean().describe("CARES conservation species").optional(),
  external_references: z.array(z.string()).describe("Array of reference URLs").optional(),
  image_links: z.array(z.string()).describe("Array of image URLs").optional(),
});

const deleteSpeciesGroupSchema = z.object({
  group_id: positiveId.describe("Species ID"),
});

const addSpeciesNameSchema = z.object({
  group_id: positiveId.describe("Species ID"),
  kind: z
    .enum(["common", "scientific"])
    .describe("Which kind of Name: a common name or a scientific name"),
  name: z.string().describe("The Name's text"),
});

const updateSpeciesNameSchema = z.object({
  kind: z
    .enum(["common", "scientific"])
    .describe("Which kind of Name: a common name or a scientific name"),
  name_id: positiveId.describe("The Name's id (unique within its kind)"),
  name: z.string().describe("The corrected text"),
});

const removeSpeciesNameSchema = z.object({
  kind: z
    .enum(["common", "scientific"])
    .describe("Which kind of Name: a common name or a scientific name"),
  name_id: positiveId.describe("The Name's id (unique within its kind)"),
});

const findNamesByTextSchema = z.object({
  text: z.string().describe("The Name's text"),
  kind: z
    .enum(["common", "scientific"])
    .describe("Only this kind of Name (optional; default both)")
    .optional(),
  limit: z
    .number()
    .int()
    .nonnegative()
    .describe("Optional limit on results (default: no limit)")
    .optional(),
});

const bulkRemoveNamesSchema = z
  .object({
    kind: z
      .enum(["common", "scientific"])
      .describe("Which kind of Name: a common name or a scientific name"),
    text: z
      .string()
      .describe("Remove every Name of this kind with this text, across all Species")
      .optional(),
    name_ids: z
      .array(positiveId)
      .min(1)
      .describe("Name ids to remove (alternative to text)")
      .optional(),
    preview: z
      .boolean()
      .describe("If true, return what would be removed without removing it (default: false)")
      .optional(),
  })
  .and(
    z.union([
      z.object({ text: z.string().min(1), name_ids: z.never().optional() }),
      z.object({ text: z.never().optional(), name_ids: z.array(positiveId).min(1) }),
    ])
  )
  .describe("Provide exactly one of text or name_ids");

const mergeSpeciesGroupsSchema = z.object({
  canonical_group_id: positiveId.describe("Species group to keep"),
  defunct_group_id: positiveId.describe("Species group to merge and delete"),
  preview: z.boolean().describe("Preview changes without executing (default: false)").optional(),
});

const searchSpeciesSchema = z.object({
  query: z.string().describe("Search text (searches the Canonical name and every Name)").optional(),
  species_type: z.enum(catalogue.speciesTypes).describe("Filter by species type").optional(),
  program_class: z.string().describe("Filter by program class").optional(),
  has_base_points: z.boolean().describe("Filter by presence of base points").optional(),
  is_cares_species: z.boolean().describe("Filter CARES species").optional(),
  sort_by: z.enum(["name", "points", "class"]).describe("Sort order (default: name)").optional(),
  limit: z.number().int().nonnegative().describe("Max results (default: 100)").optional(),
  offset: z.number().int().nonnegative().describe("Skip results (default: 0)").optional(),
  count_only: z
    .boolean()
    .describe("Return only the total count, not the results (default: false)")
    .optional(),
});

const getSpeciesDetailSchema = z.object({
  group_id: positiveId.describe("Species group ID"),
});

const setBasePointsSchema = z
  .object({
    group_id: positiveId.describe("Single species group ID (optional)").optional(),
    group_ids: z
      .array(positiveId)
      .min(1)
      .describe("Multiple species group IDs (optional)")
      .optional(),
    species_type: z.string().describe("Filter by species type (optional)").optional(),
    program_class: z.string().describe("Filter by program class (optional)").optional(),
    base_points: z.literal(catalogue.pointClasses).describe("Point class to set: 5, 10, 15 or 20"),
    preview: z.boolean().describe("Preview changes without executing (default: false)").optional(),
  })
  .and(
    z.union([
      z.object({
        group_id: positiveId,
        group_ids: z.never().optional(),
        species_type: z.never().optional(),
        program_class: z.never().optional(),
      }),
      z.object({
        group_id: z.never().optional(),
        group_ids: z.array(positiveId).min(1),
        species_type: z.never().optional(),
        program_class: z.never().optional(),
      }),
      z.object({
        group_id: z.never().optional(),
        group_ids: z.never().optional(),
        species_type: z.string().min(1),
        program_class: z.string().optional(),
      }),
      z.object({
        group_id: z.never().optional(),
        group_ids: z.never().optional(),
        species_type: z.string().optional(),
        program_class: z.string().min(1),
      }),
    ])
  )
  .describe(
    "Choose group_id, group_ids, or species_type/program_class filters; filters may be combined"
  );

const toggleCaresStatusSchema = z.object({
  group_id: positiveId.describe("Species group ID"),
  is_cares_species: z.boolean().describe("CARES status"),
});

const updateCanonicalNameSchema = z
  .object({
    group_id: positiveId.describe("Species group ID"),
    new_canonical_genus: z.string().describe("New genus name (optional)").optional(),
    new_canonical_species_name: z.string().describe("New species name (optional)").optional(),
  })
  .and(
    z.union([
      z.object({ new_canonical_genus: z.string().min(1) }),
      z.object({ new_canonical_species_name: z.string().min(1) }),
    ])
  );

const syncIucnDataSchema = z
  .object({
    group_id: positiveId.describe("Single species group ID (optional)").optional(),
    group_ids: z
      .array(positiveId)
      .min(1)
      .describe("Multiple species group IDs (optional)")
      .optional(),
    sync_missing: z.boolean().describe("Sync all species missing IUCN data (optional)").optional(),
    days_old: z
      .number()
      .int()
      .nonnegative()
      .describe("Sync species with data older than N days (optional)")
      .optional(),
    limit: z
      .number()
      .int()
      .nonnegative()
      .describe("Limit number of species to sync (default: 10)")
      .optional(),
    preview: z
      .boolean()
      .describe("Preview which species would be synced without executing (default: false)")
      .optional(),
  })
  .and(
    z.union([
      z.object({
        group_id: positiveId,
        group_ids: z.never().optional(),
        sync_missing: z.literal(false).optional(),
        days_old: z.never().optional(),
      }),
      z.object({
        group_id: z.never().optional(),
        group_ids: z.array(positiveId).min(1),
        sync_missing: z.literal(false).optional(),
        days_old: z.never().optional(),
      }),
      z.object({
        group_id: z.never().optional(),
        group_ids: z.never().optional(),
        sync_missing: z.literal(true),
        days_old: z.never().optional(),
      }),
      z.object({
        group_id: z.never().optional(),
        group_ids: z.never().optional(),
        sync_missing: z.literal(false).optional(),
        days_old: z.number().int().nonnegative(),
      }),
    ])
  )
  .describe("Choose exactly one of group_id, group_ids, sync_missing=true or days_old");

const getIucnSyncLogSchema = z.object({
  group_id: positiveId.describe("Filter by species group ID (optional)").optional(),
  limit: z.number().int().nonnegative().describe("Max entries to return (default: 100)").optional(),
});

const getSpeciesMissingIucnSchema = z.object({});

const getSpeciesNeedingResyncSchema = z.object({
  days_old: z
    .number()
    .int()
    .nonnegative()
    .describe("Consider data stale after this many days (default: 365)")
    .optional(),
});

const getIucnSyncStatsSchema = z.object({});

const getCanonicalRecommendationsSchema = z.object({
  group_id: positiveId.describe("Filter by species group ID (optional)").optional(),
  status: z
    .enum(["pending", "accepted", "rejected"])
    .describe("Filter by status (optional, default shows all)")
    .optional(),
  limit: z
    .number()
    .int()
    .nonnegative()
    .describe("Max recommendations to return (default: no limit)")
    .optional(),
});

const acceptCanonicalRecommendationSchema = z.object({
  recommendation_id: positiveId.describe("ID of the recommendation to accept"),
  reviewed_by: positiveId.describe("Member ID of admin accepting the recommendation"),
});

const rejectCanonicalRecommendationSchema = z.object({
  recommendation_id: positiveId.describe("ID of the recommendation to reject"),
  reviewed_by: positiveId.describe("Member ID of admin rejecting the recommendation"),
});

/** More than the catalogue holds: a page size that means "every Species". */
const ALL_SPECIES = 100000;

/** Every Species matching the admin filters, for the resources. */
async function listSpecies(filters: SpeciesAdminFilters): Promise<SpeciesAdminListItem[]> {
  return (await catalogue.getSpeciesForAdmin(filters, "name", ALL_SPECIES, 0)).species;
}

/** Every Name of the given text, across all Species, with the Canonical name of the Species it names. */
async function findNamesByText(text: string, kind?: NameKind) {
  const names = await catalogue.findNames(text, kind);
  const species = new Map(
    (await catalogue.findSpeciesByIds([...new Set(names.map((n) => n.species_id))])).map((sp) => [
      sp.group_id,
      sp,
    ])
  );
  return names.map((name) => {
    const sp = species.get(name.species_id);
    return {
      ...name,
      canonical_name: sp ? canonicalName(sp) : null,
      program_class: sp?.program_class ?? null,
    };
  });
}

// Format a Species for a resource or tool response
async function formatSpeciesGroup(group: Species | SpeciesAdminListItem): Promise<{
  group_id: number;
  program_class: string;
  canonical_genus: string;
  canonical_species_name: string;
  species_type: string;
  base_points: number | null;
  is_cares_species: boolean;
  external_references: string[];
  image_links: string[];
}> {
  const [externalRefs, images] = await Promise.all([
    getSpeciesExternalReferences(group.group_id),
    getSpeciesImages(group.group_id),
  ]);

  return {
    group_id: group.group_id,
    program_class: group.program_class,
    canonical_genus: group.canonical_genus,
    canonical_species_name: group.canonical_species_name,
    species_type: group.species_type,
    base_points: group.base_points,
    is_cares_species: Boolean(group.is_cares_species),
    external_references: externalRefs.map((ref) => ref.reference_url),
    image_links: images.map((img) => img.image_url),
  };
}

/**
 * Initialize the Species MCP server with all handlers and tools.
 * This function is transport-agnostic and can be used with stdio or HTTP.
 */
export function initializeSpeciesServer(server: Server): void {
  /**
   * LIST RESOURCES HANDLER
   */
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "species://groups/list",
          name: "All Species Groups",
          description: "List all species groups with basic information",
          mimeType: "application/json",
        },
        {
          uri: "species://groups/by-type/Fish",
          name: "Fish Species",
          description: "List all fish species",
          mimeType: "application/json",
        },
        {
          uri: "species://groups/by-type/Plant",
          name: "Plant Species",
          description: "List all plant species",
          mimeType: "application/json",
        },
        {
          uri: "species://groups/by-type/Invert",
          name: "Invertebrate Species",
          description: "List all invertebrate species",
          mimeType: "application/json",
        },
        {
          uri: "species://groups/by-type/Coral",
          name: "Coral Species",
          description: "List all coral species",
          mimeType: "application/json",
        },
        {
          uri: "species://groups/cares",
          name: "CARES Species",
          description: "List all CARES conservation priority species",
          mimeType: "application/json",
        },
        {
          uri: "species://statistics",
          name: "Species Statistics",
          description: "Get aggregate statistics about the species database",
          mimeType: "application/json",
        },
        {
          uri: "species://iucn/statistics",
          name: "IUCN Sync Statistics",
          description: "Get statistics about IUCN Red List data sync operations",
          mimeType: "application/json",
        },
        {
          uri: "species://iucn/missing",
          name: "Species Missing IUCN Data",
          description: "List species that don't have IUCN conservation status data",
          mimeType: "application/json",
        },
        {
          uri: "species://iucn/by-category/CR",
          name: "Critically Endangered Species",
          description: "List all Critically Endangered species",
          mimeType: "application/json",
        },
        {
          uri: "species://iucn/by-category/EN",
          name: "Endangered Species",
          description: "List all Endangered species",
          mimeType: "application/json",
        },
        {
          uri: "species://iucn/by-category/VU",
          name: "Vulnerable Species",
          description: "List all Vulnerable species",
          mimeType: "application/json",
        },
      ],
    };
  });

  /**
   * READ RESOURCE HANDLER
   */
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    try {
      // species://groups/list
      if (uri === "species://groups/list") {
        const groups = await listSpecies({});
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(await Promise.all(groups.map(formatSpeciesGroup)), null, 2),
            },
          ],
        };
      }

      // species://groups/{group_id}
      const groupMatch = uri.match(/^species:\/\/groups\/(\d+)$/);
      if (groupMatch) {
        const groupId = parseInt(groupMatch[1]);
        const species = await catalogue.findSpeciesById(groupId);
        if (!species) {
          throw new Error(`Species ${groupId} not found`);
        }
        const names = await catalogue.listNames(groupId);
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  ...(await formatSpeciesGroup(species)),
                  common_names: names.common,
                  scientific_names: names.scientific,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // species://groups/by-type/{type}
      const typeMatch = uri.match(/^species:\/\/groups\/by-type\/(\w+)$/);
      if (typeMatch) {
        const speciesType = typeMatch[1];
        const groups = await listSpecies({ species_type: speciesType });
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(await Promise.all(groups.map(formatSpeciesGroup)), null, 2),
            },
          ],
        };
      }

      // species://groups/by-class/{class}
      const classMatch = uri.match(/^species:\/\/groups\/by-class\/(.+)$/);
      if (classMatch) {
        const programClass = decodeURIComponent(classMatch[1]);
        const groups = await listSpecies({ program_class: programClass });
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(await Promise.all(groups.map(formatSpeciesGroup)), null, 2),
            },
          ],
        };
      }

      // species://groups/cares
      if (uri === "species://groups/cares") {
        const groups = await listSpecies({ is_cares_species: true });
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(await Promise.all(groups.map(formatSpeciesGroup)), null, 2),
            },
          ],
        };
      }

      // species://names/by-group/{group_id}
      const namesByGroupMatch = uri.match(/^species:\/\/names\/by-group\/(\d+)$/);
      if (namesByGroupMatch) {
        const groupId = parseInt(namesByGroupMatch[1]);
        const names = await catalogue.listNames(groupId);
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(names, null, 2),
            },
          ],
        };
      }

      // species://statistics
      if (uri === "species://statistics") {
        const statistics = await catalogue.getSpeciesStatistics();
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(statistics, null, 2),
            },
          ],
        };
      }

      // species://iucn/statistics
      if (uri === "species://iucn/statistics") {
        const database = db();
        const stats = await getIucnSyncStats(database);
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(stats, null, 2),
            },
          ],
        };
      }

      // species://iucn/missing
      if (uri === "species://iucn/missing") {
        const database = db();
        const missing = await getSpeciesWithMissingIucn(database);
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(missing, null, 2),
            },
          ],
        };
      }

      // species://iucn/by-category/{category}
      const iucnCategoryMatch = uri.match(/^species:\/\/iucn\/by-category\/(\w+)$/);
      if (iucnCategoryMatch) {
        const category = iucnCategoryMatch[1];
        const groups = await listSpecies({ iucn_category: category });
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(await Promise.all(groups.map(formatSpeciesGroup)), null, 2),
            },
          ],
        };
      }

      // species://iucn/sync-log
      if (uri === "species://iucn/sync-log") {
        const database = db();
        const log = await getIucnSyncLog(database, undefined, 100);
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(log, null, 2),
            },
          ],
        };
      }

      throw new Error(`Unknown resource URI: ${uri}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to read resource ${uri}: ${message}`, { cause: error });
    }
  });

  registerTools(server, [
    defineTool(
      "create_species_group",
      "Creates a new species group with canonical taxonomic name",
      createSpeciesGroupSchema,
      handleCreateSpeciesGroup
    ),
    defineTool(
      "update_species_group",
      "Updates a Species' Program class, Point class, CARES flag, external references and images. The Canonical name changes only through update_canonical_name.",
      updateSpeciesGroupSchema,
      handleUpdateSpeciesGroup
    ),
    defineTool(
      "delete_species_group",
      "Deletes a Species, its Names, images, links and sync records (DESTRUCTIVE). Refused while any Submission, collection entry or CARES record references the Species; merge it into another Species instead.",
      deleteSpeciesGroupSchema,
      handleDeleteSpeciesGroup
    ),
    defineTool(
      "add_species_name",
      "Adds one Name, common or scientific, to a Species",
      addSpeciesNameSchema,
      handleAddSpeciesName
    ),
    defineTool(
      "update_species_name",
      "Corrects the text of one Name in place. The Name keeps its id, so Submissions referencing it still do. Refused on a Species' Canonical name (a Name with canonical: true): use update_canonical_name.",
      updateSpeciesNameSchema,
      handleUpdateSpeciesName
    ),
    defineTool(
      "remove_species_name",
      "Removes one Name, common or scientific, from its Species. Refused on the Species' Canonical name (a Name with canonical: true).",
      removeSpeciesNameSchema,
      handleRemoveSpeciesName
    ),
    defineTool(
      "find_names_by_text",
      "Finds every Name with this exact text (ignoring case) across all Species, with the Species each one names",
      findNamesByTextSchema,
      handleFindNamesByText
    ),
    defineTool(
      "bulk_remove_names",
      "Removes Names of one kind, either every Name with a given text or a list of Name ids, in one transaction. Refused, removing nothing, if any of them is a Species' Canonical name. Use preview to see what would be removed.",
      bulkRemoveNamesSchema,
      handleBulkRemoveNames
    ),
    defineTool(
      "merge_species_groups",
      "Merges the defunct Species into the canonical one: every Name moves (deduplicated), the defunct Species' Canonical name is kept as a scientific Name, and its Submissions are rebound to the canonical Species. Approved Submissions and their Points are untouched. Collection entries, CARES records, images and links move too; the defunct Species' sync logs and IUCN recommendations are dropped. A member keeping both Species keeps the canonical one's collection entry (with the earlier CARES registration); the other is marked removed.",
      mergeSpeciesGroupsSchema,
      handleMergeSpeciesGroups
    ),
    defineTool(
      "search_species",
      "Search species with filters and sorting",
      searchSpeciesSchema,
      handleSearchSpecies
    ),
    defineTool(
      "get_species_detail",
      "Get comprehensive details for a single Species, including its Names",
      getSpeciesDetailSchema,
      handleGetSpeciesDetail
    ),
    defineTool(
      "set_base_points",
      "Set the Point class of Species (individual or bulk). Only 5, 10, 15 or 20 is accepted; anything else is refused.",
      setBasePointsSchema,
      handleSetBasePoints
    ),
    defineTool(
      "toggle_cares_status",
      "Mark species as CARES conservation priority or remove CARES status",
      toggleCaresStatusSchema,
      handleToggleCaresStatus
    ),
    defineTool(
      "update_canonical_name",
      "Rename a Species' Canonical name (for taxonomic revisions). The old Canonical name is always kept as a scientific Name, never a common Name - the same rename as the admin edit form.",
      updateCanonicalNameSchema,
      handleUpdateCanonicalName
    ),
    defineTool(
      "sync_iucn_data",
      "Sync IUCN Red List conservation status data from the IUCN API",
      syncIucnDataSchema,
      handleSyncIucnData
    ),
    defineTool(
      "get_iucn_sync_log",
      "Get log of IUCN sync operations",
      getIucnSyncLogSchema,
      handleGetIucnSyncLog
    ),
    defineTool(
      "get_species_missing_iucn",
      "List species that don't have IUCN conservation status data",
      getSpeciesMissingIucnSchema,
      handleGetSpeciesMissingIucn
    ),
    defineTool(
      "get_species_needing_resync",
      "List species with stale IUCN data that needs updating",
      getSpeciesNeedingResyncSchema,
      handleGetSpeciesNeedingResync
    ),
    defineTool(
      "get_iucn_sync_stats",
      "Get statistics about IUCN sync operations",
      getIucnSyncStatsSchema,
      handleGetIucnSyncStats
    ),
    defineTool(
      "get_canonical_recommendations",
      "Get list of taxonomic name change recommendations from IUCN (when IUCN has species under a different name)",
      getCanonicalRecommendationsSchema,
      handleGetCanonicalRecommendations
    ),
    defineTool(
      "accept_canonical_recommendation",
      "Accept a taxonomic name change recommendation (updates the Canonical name, keeps the old one as a scientific Name)",
      acceptCanonicalRecommendationSchema,
      handleAcceptCanonicalRecommendation
    ),
    defineTool(
      "reject_canonical_recommendation",
      "Reject a taxonomic name change recommendation (keeps current name unchanged)",
      rejectCanonicalRecommendationSchema,
      handleRejectCanonicalRecommendation
    ),
  ]);
}

/**
 * TOOL IMPLEMENTATIONS
 */

/** A successful tool response carrying `body` as JSON. */
function ok(body: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ success: true, ...body }, null, 2) }],
  };
}

async function handleCreateSpeciesGroup(args: z.infer<typeof createSpeciesGroupSchema>) {
  const group_id = await catalogue.createSpecies({
    programClass: args.program_class,
    speciesType: args.species_type,
    canonicalGenus: args.canonical_genus,
    canonicalSpeciesName: args.canonical_species_name,
    pointClass: args.base_points,
    isCaresSpecies: args.is_cares_species,
  });
  return ok({ group_id, message: "Species created successfully" });
}

async function handleUpdateSpeciesGroup(args: z.infer<typeof updateSpeciesGroupSchema>) {
  const {
    group_id,
    program_class,
    base_points,
    is_cares_species,
    external_references,
    image_links,
  } = args;

  if (!(await catalogue.findSpeciesById(group_id))) {
    return ok({ group_id, changes: 0, message: "Species not found" });
  }
  // Refuse a bad Point class before anything is written
  if (base_points !== undefined) admitPointClass(base_points);

  let changes = 0;
  if (program_class !== undefined || base_points !== undefined || is_cares_species !== undefined) {
    changes = await catalogue.updateSpecies(group_id, {
      programClass: program_class,
      pointClass: base_points,
      isCaresSpecies: is_cares_species,
    });
  }
  if (external_references !== undefined) {
    await setSpeciesExternalReferences(group_id, external_references);
  }
  if (image_links !== undefined) {
    await setSpeciesImages(group_id, image_links);
  }

  return ok({
    group_id,
    changes,
    updated_fields: Object.keys(args).filter((k) => k !== "group_id"),
    message: "Species updated successfully",
  });
}

async function handleDeleteSpeciesGroup(args: z.infer<typeof deleteSpeciesGroupSchema>) {
  const changes = await catalogue.deleteSpecies(args.group_id);
  return ok({ group_id: args.group_id, changes, message: "Species deleted successfully" });
}

async function handleAddSpeciesName(args: z.infer<typeof addSpeciesNameSchema>) {
  const name_id = await catalogue.addName(args.group_id, args.kind, args.name);
  return ok({
    kind: args.kind,
    name_id,
    group_id: args.group_id,
    message: "Name added successfully",
  });
}

async function handleUpdateSpeciesName(args: z.infer<typeof updateSpeciesNameSchema>) {
  const changes = await catalogue.updateName(args.kind, args.name_id, args.name);
  return ok({
    kind: args.kind,
    name_id: args.name_id,
    changes,
    message: changes > 0 ? "Name updated successfully" : "Name not found",
  });
}

async function handleRemoveSpeciesName(args: z.infer<typeof removeSpeciesNameSchema>) {
  const changes = await catalogue.removeName(args.kind, args.name_id);
  return ok({
    kind: args.kind,
    name_id: args.name_id,
    changes,
    message: changes > 0 ? "Name removed successfully" : "Name not found",
  });
}

async function handleFindNamesByText(args: z.infer<typeof findNamesByTextSchema>) {
  const found = await findNamesByText(args.text, args.kind);
  const results = args.limit ? found.slice(0, args.limit) : found;
  return ok({ text: args.text, count: results.length, results });
}

async function handleBulkRemoveNames(args: z.infer<typeof bulkRemoveNamesSchema>) {
  const { kind, text, name_ids, preview = false } = args;

  if (!text && !name_ids) {
    throw new Error("Must provide either 'text' or 'name_ids'");
  }
  if (text && name_ids) {
    throw new Error("Cannot provide both 'text' and 'name_ids'");
  }

  const matched = text ? await findNamesByText(text, kind) : undefined;
  const ids = matched ? matched.map((n) => n.name_id) : (name_ids ?? []);

  if (preview) {
    const previewResults = matched;
    return ok({
      preview: true,
      kind,
      count: ids.length,
      ...(previewResults ? { preview_results: previewResults } : { name_ids: ids }),
      message: `Preview: Would remove ${ids.length} ${kind} name(s)`,
    });
  }

  const count = await catalogue.removeName(kind, ids);
  return ok({ preview: false, kind, count, message: `Removed ${count} ${kind} name(s)` });
}

async function handleMergeSpeciesGroups(args: z.infer<typeof mergeSpeciesGroupsSchema>) {
  const { canonical_group_id, defunct_group_id, preview } = args;

  const plan = await catalogue.previewMerge(canonical_group_id, defunct_group_id);
  const summary = {
    canonical_group_id,
    defunct_group_id,
    common_names_moved: plan.moving.common.length,
    scientific_names_moved: plan.moving.scientific.length,
    submissions_updated: plan.submissions.total,
    preview_data: {
      canonical_name: plan.winnerCanonicalName,
      defunct_name: plan.loserCanonicalName,
      common_names_to_move: plan.moving.common,
      scientific_names_to_move: plan.moving.scientific,
      common_names_already_held: plan.folding.common,
      scientific_names_already_held: plan.folding.scientific,
      defunct_canonical_name_kept_as_scientific_name: plan.keepsLoserCanonicalName,
      submissions_to_update: plan.submissions.total,
      approved_submissions_to_update: plan.submissions.approved,
      references_to_move: {
        collection_entries: plan.references.collection,
        cares_registrations: plan.references.caresRegistrations,
        cares_articles: plan.references.caresArticles,
        cares_fry_shares: plan.references.caresFryShares,
        images: plan.references.images,
        external_references: plan.references.externalReferences,
      },
      canonical_becomes_cares: plan.winnerBecomesCares,
      // Each keeps the canonical Species' entry; the defunct one's is marked removed.
      members_keeping_both: plan.membersKeepingBoth.map((c) => ({
        member_id: c.memberId,
        display_name: c.displayName,
      })),
    },
  };

  if (preview) {
    return ok({
      preview: true,
      ...summary,
      message: "Preview of merge operation (no changes made)",
    });
  }

  await catalogue.mergeSpecies(canonical_group_id, defunct_group_id);
  return ok({ ...summary, message: "Species merged successfully" });
}

async function handleSearchSpecies(args: z.infer<typeof searchSpeciesSchema>) {
  const {
    query: searchQuery,
    species_type,
    program_class,
    has_base_points,
    is_cares_species,
    sort_by = "name",
    limit = 100,
    offset = 0,
    count_only = false,
  } = args;

  const filters: SpeciesAdminFilters = {
    species_type,
    program_class,
    has_base_points,
    is_cares_species,
    search: searchQuery,
  };

  const result = await catalogue.getSpeciesForAdmin(filters, sort_by, limit, offset);

  // If count_only is true, return just the count
  if (count_only) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              total_count: result.total_count,
              count_only: true,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            total_count: result.total_count,
            returned_count: result.species.length,
            results: result.species.map((s) => ({
              group_id: s.group_id,
              program_class: s.program_class,
              canonical_genus: s.canonical_genus,
              canonical_species_name: s.canonical_species_name,
              species_type: s.species_type,
              base_points: s.base_points,
              is_cares_species: Boolean(s.is_cares_species),
              name_count: s.name_count,
            })),
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleGetSpeciesDetail(args: z.infer<typeof getSpeciesDetailSchema>) {
  const { group_id } = args;

  const speciesDetail = await catalogue.getSpeciesDetail(group_id);

  if (!speciesDetail) {
    throw new Error(`Species group ${group_id} not found`);
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            species: speciesDetail,
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleSetBasePoints(args: z.infer<typeof setBasePointsSchema>) {
  const { group_id, group_ids, species_type, program_class, base_points, preview } = args;

  // Refuse anything but a Point class before looking for targets, even in preview
  admitPointClass(base_points);

  // Determine which species to update
  let targetGroupIds: number[];

  if (group_id) {
    targetGroupIds = [group_id];
  } else if (group_ids && group_ids.length > 0) {
    targetGroupIds = group_ids;
  } else if (species_type || program_class) {
    // Query to get group_ids matching filters
    const filters: SpeciesAdminFilters = { species_type, program_class };
    const result = await catalogue.getSpeciesForAdmin(filters, "name", ALL_SPECIES, 0);
    targetGroupIds = result.species.map((s) => s.group_id);
  } else {
    throw new Error("Must provide group_id, group_ids, or species_type/program_class filter");
  }

  if (targetGroupIds.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              updated_count: 0,
              message: "No species matched the criteria",
            },
            null,
            2
          ),
        },
      ],
    };
  }

  const affected = await catalogue.findSpeciesByIds(targetGroupIds);

  if (preview) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              preview: true,
              updated_count: affected.length,
              updated_species: affected.map((s) => ({
                group_id: s.group_id,
                canonical_name: `${s.canonical_genus} ${s.canonical_species_name}`,
                old_points: s.base_points,
                new_points: base_points,
              })),
              message: "Preview of base points update (no changes made)",
            },
            null,
            2
          ),
        },
      ],
    };
  }

  const changes = await catalogue.setPointClass(targetGroupIds, base_points);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            updated_count: changes,
            updated_species: affected.map((s) => ({
              group_id: s.group_id,
              canonical_name: `${s.canonical_genus} ${s.canonical_species_name}`,
              old_points: s.base_points,
              new_points: base_points,
            })),
            message: `Base points updated for ${changes} species`,
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleToggleCaresStatus(args: z.infer<typeof toggleCaresStatusSchema>) {
  const { group_id, is_cares_species } = args;
  const changes = await catalogue.updateSpecies(group_id, { isCaresSpecies: is_cares_species });
  return ok({
    group_id,
    changes,
    is_cares_species,
    message: changes > 0 ? "CARES status updated" : "Species not found",
  });
}

/**
 * The same rename as the admin edit form: the catalogue's `renameCanonical`,
 * which keeps the old Canonical name as a scientific Name.
 */
async function handleUpdateCanonicalName(args: z.infer<typeof updateCanonicalNameSchema>) {
  const { group_id, new_canonical_genus, new_canonical_species_name } = args;

  if (!new_canonical_genus && !new_canonical_species_name) {
    throw new Error("At least one new field must be provided");
  }

  const species = await catalogue.findSpeciesById(group_id);
  if (!species) {
    throw new Error(`Species ${group_id} not found`);
  }

  const oldCanonicalName = canonicalName(species);
  await catalogue.renameCanonical(
    group_id,
    new_canonical_genus ?? species.canonical_genus,
    new_canonical_species_name ?? species.canonical_species_name
  );
  const renamed = await catalogue.findSpeciesById(group_id);

  return ok({
    group_id,
    old_canonical_name: oldCanonicalName,
    new_canonical_name: renamed ? canonicalName(renamed) : oldCanonicalName,
    message: "Canonical name updated; the old Canonical name is kept as a scientific Name",
  });
}

/**
 * IUCN TOOL IMPLEMENTATIONS
 */

async function handleSyncIucnData(args: z.infer<typeof syncIucnDataSchema>) {
  const { group_id, group_ids, sync_missing, days_old, limit = 10, preview = false } = args;

  const database = db(true); // Write access for IUCN data updates
  let targetSpecies: {
    group_id: number;
    canonical_genus: string;
    canonical_species_name: string;
  }[];

  // Determine which species to sync
  if (group_id) {
    const species = await catalogue.findSpeciesById(group_id);
    if (!species) {
      throw new Error(`Species ${group_id} not found`);
    }
    targetSpecies = [species];
  } else if (group_ids && group_ids.length > 0) {
    targetSpecies = await catalogue.findSpeciesByIds(group_ids);
  } else if (sync_missing) {
    targetSpecies = await getSpeciesWithMissingIucn(database);
  } else if (days_old !== undefined) {
    targetSpecies = await getSpeciesNeedingResync(database, days_old);
  } else {
    throw new Error("Must provide group_id, group_ids, sync_missing=true, or days_old parameter");
  }

  // Apply limit
  if (targetSpecies.length > limit) {
    targetSpecies = targetSpecies.slice(0, limit);
  }

  if (targetSpecies.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              synced_count: 0,
              message: "No species matched the criteria",
            },
            null,
            2
          ),
        },
      ],
    };
  }

  if (preview) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              preview: true,
              species_to_sync: targetSpecies.map((s) => ({
                group_id: s.group_id,
                name: `${s.canonical_genus} ${s.canonical_species_name}`,
              })),
              total_count: targetSpecies.length,
              message: "Preview of species to sync (no changes made)",
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Perform actual sync
  const iucnClient = getIUCNClient();
  const results = [];

  for (const species of targetSpecies) {
    const scientificName = `${species.canonical_genus} ${species.canonical_species_name}`;
    let status: SyncStatus = "not_found";
    let errorMessage: string | undefined;
    let iucnData: IUCNData | undefined;

    try {
      const iucnResult = await iucnClient.getSpeciesByName(scientificName);

      if (iucnResult) {
        status = "success";
        iucnData = {
          category: iucnResult.category,
          taxonId: iucnResult.taxonid,
          populationTrend: iucnResult.population_trend,
        };

        // Update the database
        await updateIucnStatus(species.group_id, iucnData);
      }
    } catch (error) {
      status = "api_error";
      errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error(`Failed to sync IUCN data for ${scientificName}`, error);
    }

    // Record sync attempt
    await recordIucnSync(database, species.group_id, status, iucnData, errorMessage);

    results.push({
      group_id: species.group_id,
      scientific_name: scientificName,
      status,
      category: iucnData?.category,
      error: errorMessage,
    });
  }

  const successCount = results.filter((r) => r.status === "success").length;
  const notFoundCount = results.filter((r) => r.status === "not_found").length;
  const errorCount = results.filter((r) => r.status === "api_error").length;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            synced_count: targetSpecies.length,
            success_count: successCount,
            not_found_count: notFoundCount,
            error_count: errorCount,
            results,
            message: `Synced ${successCount} of ${targetSpecies.length} species successfully`,
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleGetIucnSyncLog(args: z.infer<typeof getIucnSyncLogSchema>) {
  const { group_id, limit = 100 } = args;

  const database = db();
  const log = await getIucnSyncLog(database, group_id, limit);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            total_entries: log.length,
            log_entries: log,
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleGetSpeciesMissingIucn() {
  const database = db();
  const missing = await getSpeciesWithMissingIucn(database);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            total_count: missing.length,
            species: missing,
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleGetSpeciesNeedingResync(args: z.infer<typeof getSpeciesNeedingResyncSchema>) {
  const { days_old = 365 } = args;

  const database = db();
  const needingResync = await getSpeciesNeedingResync(database, days_old);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            total_count: needingResync.length,
            days_old_threshold: days_old,
            species: needingResync,
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleGetIucnSyncStats() {
  const database = db();
  const stats = await getIucnSyncStats(database);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            stats,
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * CANONICAL NAME RECOMMENDATION TOOL IMPLEMENTATIONS
 */

async function handleGetCanonicalRecommendations(
  args: z.infer<typeof getCanonicalRecommendationsSchema>
) {
  const { group_id, status, limit } = args;

  const database = db();
  const recommendations = await getCanonicalRecommendations(database, {
    groupId: group_id,
    status,
    limit,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            total_count: recommendations.length,
            recommendations: recommendations.map((rec) => ({
              id: rec.id,
              group_id: rec.group_id,
              current_name: `${rec.current_canonical_genus} ${rec.current_canonical_species}`,
              suggested_name: `${rec.suggested_canonical_genus} ${rec.suggested_canonical_species}`,
              iucn_taxon_id: rec.iucn_taxon_id,
              iucn_url: rec.iucn_url,
              reason: rec.reason,
              status: rec.status,
              created_at: rec.created_at,
              reviewed_at: rec.reviewed_at,
              reviewed_by: rec.reviewed_by,
            })),
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleAcceptCanonicalRecommendation(
  args: z.infer<typeof acceptCanonicalRecommendationSchema>
) {
  const { recommendation_id, reviewed_by } = args;

  const database = db(true); // Write access

  const success = await acceptCanonicalRecommendation(database, recommendation_id, reviewed_by);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success,
            recommendation_id,
            reviewed_by,
            message: "Canonical name recommendation accepted and applied successfully",
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleRejectCanonicalRecommendation(
  args: z.infer<typeof rejectCanonicalRecommendationSchema>
) {
  const { recommendation_id, reviewed_by } = args;

  const database = db(true); // Write access

  const success = await rejectCanonicalRecommendation(database, recommendation_id, reviewed_by);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success,
            recommendation_id,
            reviewed_by,
            message: "Canonical name recommendation rejected successfully",
          },
          null,
          2
        ),
      },
    ],
  };
}
