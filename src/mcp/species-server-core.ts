/**
 * Species Database MCP Server - Core Logic
 *
 * Provides reusable server initialization for both stdio and HTTP transports.
 * This module exports the server setup function that can be used by different transport layers.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
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
} from "../species";
import {
  getSpeciesExternalReferences,
  getSpeciesImages,
  setSpeciesExternalReferences,
  setSpeciesImages,
} from "../db/speciesEnrichment";
import {
  updateIucnData,
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
  type RecommendationStatus,
} from "../db/iucn";
import { getIUCNClient } from "../integrations/iucn";

// Tool argument types
type CreateSpeciesGroupArgs = {
  program_class: string;
  canonical_genus: string;
  canonical_species_name: string;
  species_type: string;
  base_points?: number;
  is_cares_species?: boolean;
};

type UpdateSpeciesGroupArgs = {
  group_id: number;
  program_class?: string;
  base_points?: number;
  is_cares_species?: boolean;
  external_references?: string[];
  image_links?: string[];
};

type DeleteSpeciesGroupArgs = {
  group_id: number;
};

type AddSpeciesNameArgs = {
  group_id: number;
  kind: NameKind;
  name: string;
};

type UpdateSpeciesNameArgs = {
  kind: NameKind;
  name_id: number;
  name: string;
};

type RemoveSpeciesNameArgs = {
  kind: NameKind;
  name_id: number;
};

type MergeSpeciesGroupsArgs = {
  canonical_group_id: number;
  defunct_group_id: number;
  preview?: boolean;
};

type SearchSpeciesArgs = {
  query?: string;
  species_type?: string;
  program_class?: string;
  has_base_points?: boolean;
  is_cares_species?: boolean;
  sort_by?: string;
  limit?: number;
  offset?: number;
  count_only?: boolean;
};

type GetSpeciesDetailArgs = {
  group_id: number;
};

type SetBasePointsArgs = {
  group_id?: number;
  group_ids?: number[];
  species_type?: string;
  program_class?: string;
  base_points: number;
  preview?: boolean;
};

type ToggleCaresStatusArgs = {
  group_id: number;
  is_cares_species: boolean;
};

type UpdateCanonicalNameArgs = {
  group_id: number;
  new_canonical_genus?: string;
  new_canonical_species_name?: string;
};

type SyncIucnDataArgs = {
  group_id?: number;
  group_ids?: number[];
  sync_missing?: boolean;
  days_old?: number;
  limit?: number;
  preview?: boolean;
};

type GetIucnSyncLogArgs = {
  group_id?: number;
  limit?: number;
};

type GetSpeciesNeedingResyncArgs = {
  days_old?: number;
};

type GetCanonicalRecommendationsArgs = {
  group_id?: number;
  status?: RecommendationStatus;
  limit?: number;
};

type AcceptCanonicalRecommendationArgs = {
  recommendation_id: number;
  reviewed_by: number;
};

type RejectCanonicalRecommendationArgs = {
  recommendation_id: number;
  reviewed_by: number;
};

type FindNamesByTextArgs = {
  text: string;
  kind?: NameKind;
  limit?: number;
};

type BulkRemoveNamesArgs = {
  kind: NameKind;
  text?: string;
  name_ids?: number[];
  preview?: boolean;
};

const nameKindSchema = {
  type: "string",
  enum: ["common", "scientific"],
  description: "Which kind of Name: a common name or a scientific name",
};

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
      throw new Error(`Failed to read resource ${uri}: ${message}`);
    }
  });

  /**
   * LIST TOOLS HANDLER
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        // Core CRUD Operations
        {
          name: "create_species_group",
          description: "Creates a new species group with canonical taxonomic name",
          inputSchema: {
            type: "object",
            properties: {
              program_class: {
                type: "string",
                description: "BAP program class (e.g., Cichlids, Livebearers)",
              },
              canonical_genus: { type: "string", description: "Official genus name" },
              canonical_species_name: { type: "string", description: "Official species name" },
              species_type: {
                type: "string",
                enum: ["Fish", "Plant", "Invert", "Coral"],
                description: "High-level category",
              },
              base_points: {
                type: "number",
                enum: [5, 10, 15, 20],
                description: "Point class: 5, 10, 15 or 20 (optional; anything else is refused)",
              },
              is_cares_species: {
                type: "boolean",
                description: "CARES conservation species (optional, default: false)",
              },
            },
            required: ["program_class", "canonical_genus", "canonical_species_name", "species_type"],
          },
        },
        {
          name: "update_species_group",
          description:
            "Updates a Species' Program class, Point class, CARES flag, external references and images. The Canonical name changes only through update_canonical_name.",
          inputSchema: {
            type: "object",
            properties: {
              group_id: { type: "number", description: "Species group ID" },
              program_class: { type: "string", description: "BAP program class (e.g., Cichlids, Livebearers, Killifish)" },
              base_points: {
                type: ["number", "null"],
                enum: [5, 10, 15, 20, null],
                description: "Point class: 5, 10, 15, 20, or null to unset (anything else is refused)",
              },
              is_cares_species: { type: "boolean", description: "CARES conservation species" },
              external_references: {
                type: "array",
                items: { type: "string" },
                description: "Array of reference URLs",
              },
              image_links: {
                type: "array",
                items: { type: "string" },
                description: "Array of image URLs",
              },
            },
            required: ["group_id"],
          },
        },
        {
          name: "delete_species_group",
          description:
            "Deletes a Species and its Names (DESTRUCTIVE). Refused while any Submission references the Species; merge it into another Species instead.",
          inputSchema: {
            type: "object",
            properties: {
              group_id: { type: "number", description: "Species ID" },
            },
            required: ["group_id"],
          },
        },
        {
          name: "add_species_name",
          description: "Adds one Name, common or scientific, to a Species",
          inputSchema: {
            type: "object",
            properties: {
              group_id: { type: "number", description: "Species ID" },
              kind: nameKindSchema,
              name: { type: "string", description: "The Name's text" },
            },
            required: ["group_id", "kind", "name"],
          },
        },
        {
          name: "update_species_name",
          description:
            "Corrects the text of one Name in place. The Name keeps its id, so Submissions referencing it still do. Refused on a Species' Canonical name (a Name with canonical: true): use update_canonical_name.",
          inputSchema: {
            type: "object",
            properties: {
              kind: nameKindSchema,
              name_id: { type: "number", description: "The Name's id (unique within its kind)" },
              name: { type: "string", description: "The corrected text" },
            },
            required: ["kind", "name_id", "name"],
          },
        },
        {
          name: "remove_species_name",
          description:
            "Removes one Name, common or scientific, from its Species. Refused on the Species' Canonical name (a Name with canonical: true).",
          inputSchema: {
            type: "object",
            properties: {
              kind: nameKindSchema,
              name_id: { type: "number", description: "The Name's id (unique within its kind)" },
            },
            required: ["kind", "name_id"],
          },
        },
        {
          name: "find_names_by_text",
          description:
            "Finds every Name with this exact text (ignoring case) across all Species, with the Species each one names",
          inputSchema: {
            type: "object",
            properties: {
              text: { type: "string", description: "The Name's text" },
              kind: { ...nameKindSchema, description: "Only this kind of Name (optional; default both)" },
              limit: { type: "number", description: "Optional limit on results (default: no limit)" },
            },
            required: ["text"],
          },
        },
        {
          name: "bulk_remove_names",
          description:
            "Removes Names of one kind, either every Name with a given text or a list of Name ids, in one transaction. Refused, removing nothing, if any of them is a Species' Canonical name. Use preview to see what would be removed.",
          inputSchema: {
            type: "object",
            properties: {
              kind: nameKindSchema,
              text: {
                type: "string",
                description: "Remove every Name of this kind with this text, across all Species",
              },
              name_ids: {
                type: "array",
                items: { type: "number" },
                description: "Name ids to remove (alternative to text)",
              },
              preview: {
                type: "boolean",
                description: "If true, return what would be removed without removing it (default: false)",
              },
            },
            required: ["kind"],
          },
        },
        // Advanced Operations
        {
          name: "merge_species_groups",
          description:
            "Merges the defunct Species into the canonical one: every Name moves (deduplicated), the defunct Species' Canonical name is kept as a scientific Name, and its Submissions are rebound to the canonical Species. Approved Submissions and their Points are untouched.",
          inputSchema: {
            type: "object",
            properties: {
              canonical_group_id: { type: "number", description: "Species group to keep" },
              defunct_group_id: { type: "number", description: "Species group to merge and delete" },
              preview: {
                type: "boolean",
                description: "Preview changes without executing (default: false)",
              },
            },
            required: ["canonical_group_id", "defunct_group_id"],
          },
        },
        {
          name: "search_species",
          description: "Search species with filters and sorting",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search text (searches the Canonical name and every Name)" },
              species_type: {
                type: "string",
                enum: ["Fish", "Plant", "Invert", "Coral"],
                description: "Filter by species type",
              },
              program_class: { type: "string", description: "Filter by program class" },
              has_base_points: { type: "boolean", description: "Filter by presence of base points" },
              is_cares_species: { type: "boolean", description: "Filter CARES species" },
              sort_by: {
                type: "string",
                enum: ["name", "points", "class"],
                description: "Sort order (default: name)",
              },
              limit: { type: "number", description: "Max results (default: 100)" },
              offset: { type: "number", description: "Skip results (default: 0)" },
              count_only: {
                type: "boolean",
                description: "Return only the total count, not the results (default: false)",
              },
            },
          },
        },
        {
          name: "get_species_detail",
          description: "Get comprehensive details for a single Species, including its Names",
          inputSchema: {
            type: "object",
            properties: {
              group_id: { type: "number", description: "Species group ID" },
            },
            required: ["group_id"],
          },
        },
        {
          name: "set_base_points",
          description:
            "Set the Point class of Species (individual or bulk). Only 5, 10, 15 or 20 is accepted; anything else is refused.",
          inputSchema: {
            type: "object",
            properties: {
              group_id: { type: "number", description: "Single species group ID (optional)" },
              group_ids: {
                type: "array",
                items: { type: "number" },
                description: "Multiple species group IDs (optional)",
              },
              species_type: { type: "string", description: "Filter by species type (optional)" },
              program_class: { type: "string", description: "Filter by program class (optional)" },
              base_points: {
                type: "number",
                enum: [5, 10, 15, 20],
                description: "Point class to set: 5, 10, 15 or 20",
              },
              preview: {
                type: "boolean",
                description: "Preview changes without executing (default: false)",
              },
            },
            required: ["base_points"],
          },
        },
        {
          name: "toggle_cares_status",
          description: "Mark species as CARES conservation priority or remove CARES status",
          inputSchema: {
            type: "object",
            properties: {
              group_id: { type: "number", description: "Species group ID" },
              is_cares_species: { type: "boolean", description: "CARES status" },
            },
            required: ["group_id", "is_cares_species"],
          },
        },
        {
          name: "update_canonical_name",
          description:
            "Rename a Species' Canonical name (for taxonomic revisions). The old Canonical name is always kept as a scientific Name, never a common Name - the same rename as the admin edit form.",
          inputSchema: {
            type: "object",
            properties: {
              group_id: { type: "number", description: "Species group ID" },
              new_canonical_genus: { type: "string", description: "New genus name (optional)" },
              new_canonical_species_name: {
                type: "string",
                description: "New species name (optional)",
              },
            },
            required: ["group_id"],
          },
        },
        // IUCN Integration Tools
        {
          name: "sync_iucn_data",
          description: "Sync IUCN Red List conservation status data from the IUCN API",
          inputSchema: {
            type: "object",
            properties: {
              group_id: { type: "number", description: "Single species group ID (optional)" },
              group_ids: {
                type: "array",
                items: { type: "number" },
                description: "Multiple species group IDs (optional)",
              },
              sync_missing: {
                type: "boolean",
                description: "Sync all species missing IUCN data (optional)",
              },
              days_old: {
                type: "number",
                description: "Sync species with data older than N days (optional)",
              },
              limit: {
                type: "number",
                description: "Limit number of species to sync (default: 10)",
              },
              preview: {
                type: "boolean",
                description: "Preview which species would be synced without executing (default: false)",
              },
            },
          },
        },
        {
          name: "get_iucn_sync_log",
          description: "Get log of IUCN sync operations",
          inputSchema: {
            type: "object",
            properties: {
              group_id: { type: "number", description: "Filter by species group ID (optional)" },
              limit: { type: "number", description: "Max entries to return (default: 100)" },
            },
          },
        },
        {
          name: "get_species_missing_iucn",
          description: "List species that don't have IUCN conservation status data",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "get_species_needing_resync",
          description: "List species with stale IUCN data that needs updating",
          inputSchema: {
            type: "object",
            properties: {
              days_old: {
                type: "number",
                description: "Consider data stale after this many days (default: 365)",
              },
            },
          },
        },
        {
          name: "get_iucn_sync_stats",
          description: "Get statistics about IUCN sync operations",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        // Canonical Name Recommendation Tools
        {
          name: "get_canonical_recommendations",
          description:
            "Get list of taxonomic name change recommendations from IUCN (when IUCN has species under a different name)",
          inputSchema: {
            type: "object",
            properties: {
              group_id: {
                type: "number",
                description: "Filter by species group ID (optional)",
              },
              status: {
                type: "string",
                enum: ["pending", "accepted", "rejected"],
                description: 'Filter by status (optional, default shows all)',
              },
              limit: {
                type: "number",
                description: "Max recommendations to return (default: no limit)",
              },
            },
          },
        },
        {
          name: "accept_canonical_recommendation",
          description:
            "Accept a taxonomic name change recommendation (updates the Canonical name, keeps the old one as a scientific Name)",
          inputSchema: {
            type: "object",
            properties: {
              recommendation_id: {
                type: "number",
                description: "ID of the recommendation to accept",
              },
              reviewed_by: {
                type: "number",
                description: "Member ID of admin accepting the recommendation",
              },
            },
            required: ["recommendation_id", "reviewed_by"],
          },
        },
        {
          name: "reject_canonical_recommendation",
          description: "Reject a taxonomic name change recommendation (keeps current name unchanged)",
          inputSchema: {
            type: "object",
            properties: {
              recommendation_id: {
                type: "number",
                description: "ID of the recommendation to reject",
              },
              reviewed_by: {
                type: "number",
                description: "Member ID of admin rejecting the recommendation",
              },
            },
            required: ["recommendation_id", "reviewed_by"],
          },
        },
      ],
    };
  });

  /**
   * CALL TOOL HANDLER
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "create_species_group":
          return await handleCreateSpeciesGroup(args as CreateSpeciesGroupArgs);
        case "update_species_group":
          return await handleUpdateSpeciesGroup(args as UpdateSpeciesGroupArgs);
        case "delete_species_group":
          return await handleDeleteSpeciesGroup(args as DeleteSpeciesGroupArgs);
        case "add_species_name":
          return await handleAddSpeciesName(args as AddSpeciesNameArgs);
        case "update_species_name":
          return await handleUpdateSpeciesName(args as UpdateSpeciesNameArgs);
        case "remove_species_name":
          return await handleRemoveSpeciesName(args as RemoveSpeciesNameArgs);
        case "find_names_by_text":
          return await handleFindNamesByText(args as FindNamesByTextArgs);
        case "bulk_remove_names":
          return await handleBulkRemoveNames(args as BulkRemoveNamesArgs);
        case "merge_species_groups":
          return await handleMergeSpeciesGroups(args as MergeSpeciesGroupsArgs);
        case "search_species":
          return await handleSearchSpecies(args as SearchSpeciesArgs);
        case "get_species_detail":
          return await handleGetSpeciesDetail(args as GetSpeciesDetailArgs);
        case "set_base_points":
          return await handleSetBasePoints(args as SetBasePointsArgs);
        case "toggle_cares_status":
          return await handleToggleCaresStatus(args as ToggleCaresStatusArgs);
        case "update_canonical_name":
          return await handleUpdateCanonicalName(args as UpdateCanonicalNameArgs);
        case "sync_iucn_data":
          return await handleSyncIucnData(args as SyncIucnDataArgs);
        case "get_iucn_sync_log":
          return await handleGetIucnSyncLog(args as GetIucnSyncLogArgs);
        case "get_species_missing_iucn":
          return await handleGetSpeciesMissingIucn();
        case "get_species_needing_resync":
          return await handleGetSpeciesNeedingResync(args as GetSpeciesNeedingResyncArgs);
        case "get_iucn_sync_stats":
          return await handleGetIucnSyncStats();
        case "get_canonical_recommendations":
          return await handleGetCanonicalRecommendations(args as GetCanonicalRecommendationsArgs);
        case "accept_canonical_recommendation":
          return await handleAcceptCanonicalRecommendation(args as AcceptCanonicalRecommendationArgs);
        case "reject_canonical_recommendation":
          return await handleRejectCanonicalRecommendation(args as RejectCanonicalRecommendationArgs);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: false,
                error: message,
                error_code: "TOOL_EXECUTION_ERROR",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  });
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

async function handleCreateSpeciesGroup(args: CreateSpeciesGroupArgs) {
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

async function handleUpdateSpeciesGroup(args: UpdateSpeciesGroupArgs) {
  const { group_id, program_class, base_points, is_cares_species, external_references, image_links } = args;

  if (!(await catalogue.findSpeciesById(group_id))) {
    return ok({ group_id, changes: 0, message: "Species not found" });
  }
  // Refuse a bad Point class before anything is written
  if (base_points !== undefined) admitPointClass(base_points);

  if (program_class !== undefined || base_points !== undefined || is_cares_species !== undefined) {
    await catalogue.updateSpecies(group_id, {
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
    changes: 1,
    updated_fields: Object.keys(args).filter((k) => k !== "group_id"),
    message: "Species updated successfully",
  });
}

async function handleDeleteSpeciesGroup(args: DeleteSpeciesGroupArgs) {
  const changes = await catalogue.deleteSpecies(args.group_id);
  return ok({ group_id: args.group_id, changes, message: "Species deleted successfully" });
}

async function handleAddSpeciesName(args: AddSpeciesNameArgs) {
  const name_id = await catalogue.addName(args.group_id, args.kind, args.name);
  return ok({ kind: args.kind, name_id, group_id: args.group_id, message: "Name added successfully" });
}

async function handleUpdateSpeciesName(args: UpdateSpeciesNameArgs) {
  const changes = await catalogue.updateName(args.kind, args.name_id, args.name);
  return ok({
    kind: args.kind,
    name_id: args.name_id,
    changes,
    message: changes > 0 ? "Name updated successfully" : "Name not found",
  });
}

async function handleRemoveSpeciesName(args: RemoveSpeciesNameArgs) {
  const changes = await catalogue.removeName(args.kind, args.name_id);
  return ok({
    kind: args.kind,
    name_id: args.name_id,
    changes,
    message: changes > 0 ? "Name removed successfully" : "Name not found",
  });
}

async function handleFindNamesByText(args: FindNamesByTextArgs) {
  const found = await findNamesByText(args.text, args.kind);
  const results = args.limit ? found.slice(0, args.limit) : found;
  return ok({ text: args.text, count: results.length, results });
}

async function handleBulkRemoveNames(args: BulkRemoveNamesArgs) {
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

async function handleMergeSpeciesGroups(args: MergeSpeciesGroupsArgs) {
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
    },
  };

  if (preview) {
    return ok({ preview: true, ...summary, message: "Preview of merge operation (no changes made)" });
  }

  await catalogue.mergeSpecies(canonical_group_id, defunct_group_id);
  return ok({ ...summary, message: "Species merged successfully" });
}

async function handleSearchSpecies(args: SearchSpeciesArgs) {
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

  const result = await catalogue.getSpeciesForAdmin(
    filters,
    sort_by as "name" | "points" | "class" | undefined,
    limit,
    offset
  );

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

async function handleGetSpeciesDetail(args: GetSpeciesDetailArgs) {
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

async function handleSetBasePoints(args: SetBasePointsArgs) {
  const { group_id, group_ids, species_type, program_class, base_points, preview } = args;

  // Refuse anything but a Point class before looking for targets, even in preview
  admitPointClass(base_points);

  // Determine which species to update
  let targetGroupIds: number[] = [];

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

async function handleToggleCaresStatus(args: ToggleCaresStatusArgs) {
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
async function handleUpdateCanonicalName(args: UpdateCanonicalNameArgs) {
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

async function handleSyncIucnData(args: SyncIucnDataArgs) {
  const { group_id, group_ids, sync_missing, days_old, limit = 10, preview = false } = args;

  const database = db(true); // Write access for IUCN data updates
  let targetSpecies: { group_id: number; canonical_genus: string; canonical_species_name: string }[] = [];

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
        await updateIucnData(database, species.group_id, iucnData);
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

async function handleGetIucnSyncLog(args: GetIucnSyncLogArgs) {
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

async function handleGetSpeciesNeedingResync(args: GetSpeciesNeedingResyncArgs) {
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

async function handleGetCanonicalRecommendations(args: GetCanonicalRecommendationsArgs) {
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

async function handleAcceptCanonicalRecommendation(args: AcceptCanonicalRecommendationArgs) {
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

async function handleRejectCanonicalRecommendation(args: RejectCanonicalRecommendationArgs) {
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
