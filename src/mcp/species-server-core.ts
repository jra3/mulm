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
import { query, withTransaction, db } from "../db/conn";
import { logger } from "../utils/logger";
import {
  createSpeciesGroup,
  addSynonym,
  updateSynonym,
  deleteSynonym,
  getSynonymsForGroup,
  getSpeciesForAdmin,
  getSpeciesDetail,
  updateSpeciesGroup,
  deleteSpeciesGroup,
  bulkSetPoints,
  deleteCommonName,
  getCommonNamesByText,
  bulkDeleteCommonNames,
} from "../db/species";
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

// Type definitions for database tables
type SpeciesNameGroup = {
  group_id: number;
  program_class: string;
  canonical_genus: string;
  canonical_species_name: string;
  species_type: string;
  base_points: number | null;
  external_references: string | null;
  image_links: string | null;
  is_cares_species: number;
};

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
  force?: boolean;
};

type AddSpeciesSynonymArgs = {
  group_id: number;
  common_name: string;
  scientific_name: string;
};

type UpdateSpeciesSynonymArgs = {
  name_id: number;
  common_name?: string;
  scientific_name?: string;
};

type DeleteSpeciesSynonymArgs = {
  name_id: number;
  force?: boolean;
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
  preserve_old_as_synonym?: boolean;
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

type ListCommonNamesByTextArgs = {
  common_name: string;
  limit?: number;
};

type DeleteCommonNameByIdArgs = {
  common_name_id: number;
};

type BulkDeleteCommonNamesArgs = {
  common_name?: string;
  common_name_ids?: number[];
  preview?: boolean;
};

type SpeciesAdminFilters = {
  species_type?: string;
  program_class?: string;
  has_base_points?: boolean;
  is_cares_species?: boolean;
  search?: string;
};

// Helper function to parse JSON fields
function parseJsonField<T>(jsonString: string | null): T | null {
  if (!jsonString) return null;
  try {
    return JSON.parse(jsonString) as T;
  } catch {
    return null;
  }
}

// Helper function to format species group for response
function formatSpeciesGroup(group: SpeciesNameGroup) {
  return {
    group_id: group.group_id,
    program_class: group.program_class,
    canonical_genus: group.canonical_genus,
    canonical_species_name: group.canonical_species_name,
    species_type: group.species_type,
    base_points: group.base_points,
    is_cares_species: Boolean(group.is_cares_species),
    external_references: parseJsonField<string[]>(group.external_references) || [],
    image_links: parseJsonField<string[]>(group.image_links) || [],
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
        const groups = await query<SpeciesNameGroup>(`
          SELECT * FROM species_name_group
          ORDER BY canonical_genus, canonical_species_name
        `);
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(groups.map(formatSpeciesGroup), null, 2),
            },
          ],
        };
      }

      // species://groups/{group_id}
      const groupMatch = uri.match(/^species:\/\/groups\/(\d+)$/);
      if (groupMatch) {
        const groupId = parseInt(groupMatch[1]);
        const groups = await query<SpeciesNameGroup>(
          "SELECT * FROM species_name_group WHERE group_id = ?",
          [groupId]
        );
        if (groups.length === 0) {
          throw new Error(`Species group ${groupId} not found`);
        }
        // Use getSynonymsForGroup which handles the split tables
        const synonyms = await getSynonymsForGroup(groupId);
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  ...formatSpeciesGroup(groups[0]),
                  synonyms,
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
        const groups = await query<SpeciesNameGroup>(
          "SELECT * FROM species_name_group WHERE species_type = ? ORDER BY canonical_genus, canonical_species_name",
          [speciesType]
        );
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(groups.map(formatSpeciesGroup), null, 2),
            },
          ],
        };
      }

      // species://groups/by-class/{class}
      const classMatch = uri.match(/^species:\/\/groups\/by-class\/(.+)$/);
      if (classMatch) {
        const programClass = decodeURIComponent(classMatch[1]);
        const groups = await query<SpeciesNameGroup>(
          "SELECT * FROM species_name_group WHERE program_class = ? ORDER BY canonical_genus, canonical_species_name",
          [programClass]
        );
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(groups.map(formatSpeciesGroup), null, 2),
            },
          ],
        };
      }

      // species://groups/cares
      if (uri === "species://groups/cares") {
        const groups = await query<SpeciesNameGroup>(
          "SELECT * FROM species_name_group WHERE is_cares_species = 1 ORDER BY canonical_genus, canonical_species_name"
        );
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(groups.map(formatSpeciesGroup), null, 2),
            },
          ],
        };
      }

      // species://names/{name_id}
      const nameMatch = uri.match(/^species:\/\/names\/(\d+)$/);
      if (nameMatch) {
        const nameId = parseInt(nameMatch[1]);

        // Common type for both tables
        type NameResult = {
          name_id: number;
          group_id: number;
          common_name: string;
          scientific_name: string;
          program_class: string;
          canonical_genus: string;
          canonical_species_name: string;
          species_type: string;
        };

        // Try common_name table first
        let names = await query<NameResult>(
          `SELECT cn.common_name_id as name_id, cn.group_id, cn.common_name, '' as scientific_name,
                  sng.program_class, sng.canonical_genus, sng.canonical_species_name, sng.species_type
           FROM species_common_name cn
           JOIN species_name_group sng ON cn.group_id = sng.group_id
           WHERE cn.common_name_id = ?`,
          [nameId]
        );

        // If not found, try scientific_name table
        if (names.length === 0) {
          names = await query<NameResult>(
            `SELECT sn.scientific_name_id as name_id, sn.group_id, '' as common_name, sn.scientific_name,
                    sng.program_class, sng.canonical_genus, sng.canonical_species_name, sng.species_type
             FROM species_scientific_name sn
             JOIN species_name_group sng ON sn.group_id = sng.group_id
             WHERE sn.scientific_name_id = ?`,
            [nameId]
          );
        }

        if (names.length === 0) {
          throw new Error(`Species name ${nameId} not found`);
        }
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(names[0], null, 2),
            },
          ],
        };
      }

      // species://names/by-group/{group_id}
      const namesByGroupMatch = uri.match(/^species:\/\/names\/by-group\/(\d+)$/);
      if (namesByGroupMatch) {
        const groupId = parseInt(namesByGroupMatch[1]);
        const names = await getSynonymsForGroup(groupId);
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
        const totalCount = await query<{ count: number }>(
          "SELECT COUNT(*) as count FROM species_name_group"
        );

        const byType = await query<{ species_type: string; count: number }>(
          "SELECT species_type, COUNT(*) as count FROM species_name_group GROUP BY species_type ORDER BY species_type"
        );

        const byClass = await query<{ program_class: string; count: number }>(
          "SELECT program_class, COUNT(*) as count FROM species_name_group GROUP BY program_class ORDER BY count DESC LIMIT 10"
        );

        const caresCount = await query<{ count: number }>(
          "SELECT COUNT(*) as count FROM species_name_group WHERE is_cares_species = 1"
        );

        const withPoints = await query<{ count: number }>(
          "SELECT COUNT(*) as count FROM species_name_group WHERE base_points IS NOT NULL"
        );

        const withoutPoints = await query<{ count: number }>(
          "SELECT COUNT(*) as count FROM species_name_group WHERE base_points IS NULL"
        );

        const statistics = {
          total_species: totalCount[0].count,
          by_type: Object.fromEntries(byType.map((t) => [t.species_type, t.count])),
          top_program_classes: byClass.map((c) => ({
            program_class: c.program_class,
            count: c.count,
          })),
          cares_species: caresCount[0].count,
          with_base_points: withPoints[0].count,
          without_base_points: withoutPoints[0].count,
        };

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
        const groups = await query<SpeciesNameGroup>(
          "SELECT * FROM species_name_group WHERE iucn_redlist_category = ? ORDER BY canonical_genus, canonical_species_name",
          [category]
        );
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(groups.map(formatSpeciesGroup), null, 2),
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
              base_points: { type: "number", description: "Points awarded for breeding (optional)" },
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
          description: "Updates metadata for an existing species group",
          inputSchema: {
            type: "object",
            properties: {
              group_id: { type: "number", description: "Species group ID" },
              program_class: { type: "string", description: "BAP program class (e.g., Cichlids, Livebearers, Killifish)" },
              base_points: { type: "number", description: "Points awarded for breeding" },
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
          description: "Deletes a species group and all its name variants (DESTRUCTIVE)",
          inputSchema: {
            type: "object",
            properties: {
              group_id: { type: "number", description: "Species group ID" },
              force: {
                type: "boolean",
                description: "Force delete even if submissions exist (default: false)",
              },
            },
            required: ["group_id"],
          },
        },
        {
          name: "add_species_synonym",
          description: "Adds a common name or scientific name variant to an existing species group",
          inputSchema: {
            type: "object",
            properties: {
              group_id: { type: "number", description: "Species group ID" },
              common_name: { type: "string", description: "Common name variant" },
              scientific_name: { type: "string", description: "Scientific name variant" },
            },
            required: ["group_id", "common_name", "scientific_name"],
          },
        },
        {
          name: "update_species_synonym",
          description: "Updates an existing name variant",
          inputSchema: {
            type: "object",
            properties: {
              name_id: { type: "number", description: "Name variant ID" },
              common_name: { type: "string", description: "Common name variant" },
              scientific_name: { type: "string", description: "Scientific name variant" },
            },
            required: ["name_id"],
          },
        },
        {
          name: "delete_species_synonym",
          description: "Removes a name variant from a species group",
          inputSchema: {
            type: "object",
            properties: {
              name_id: { type: "number", description: "Name variant ID" },
              force: {
                type: "boolean",
                description: "Force delete even if last synonym (default: false)",
              },
            },
            required: ["name_id"],
          },
        },
        {
          name: "list_common_names_by_text",
          description: "Find all common names matching exact text across all species",
          inputSchema: {
            type: "object",
            properties: {
              common_name: { type: "string", description: "Common name to search for (exact match)" },
              limit: { type: "number", description: "Optional limit on results (default: no limit)" },
            },
            required: ["common_name"],
          },
        },
        {
          name: "delete_common_name_by_id",
          description: "Delete a single common name by its ID",
          inputSchema: {
            type: "object",
            properties: {
              common_name_id: { type: "number", description: "Common name ID to delete" },
            },
            required: ["common_name_id"],
          },
        },
        {
          name: "bulk_delete_common_names",
          description:
            "Delete multiple common names by text match or by IDs. Use preview mode to see what would be deleted.",
          inputSchema: {
            type: "object",
            properties: {
              common_name: {
                type: "string",
                description: "Common name text to match (exact match, deletes all species with this name)",
              },
              common_name_ids: {
                type: "array",
                items: { type: "number" },
                description: "Array of common name IDs to delete (alternative to common_name)",
              },
              preview: {
                type: "boolean",
                description: "If true, return what would be deleted without deleting (default: false)",
              },
            },
          },
        },
        // Advanced Operations
        {
          name: "merge_species_groups",
          description:
            "Merges two species groups (moves synonyms and submissions from defunct to canonical)",
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
              query: { type: "string", description: "Search text (searches names and synonyms)" },
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
          description: "Get comprehensive details for a single species including all synonyms",
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
          description: "Update point values for species (individual or bulk)",
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
              base_points: { type: "number", description: "Points value to set" },
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
          description: "Update the canonical genus and/or species name (for taxonomic revisions)",
          inputSchema: {
            type: "object",
            properties: {
              group_id: { type: "number", description: "Species group ID" },
              new_canonical_genus: { type: "string", description: "New genus name (optional)" },
              new_canonical_species_name: {
                type: "string",
                description: "New species name (optional)",
              },
              preserve_old_as_synonym: {
                type: "boolean",
                description: "Create synonym with old name (default: true)",
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
            "Accept a taxonomic name change recommendation (updates canonical name, preserves old name as synonym)",
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
        case "add_species_synonym":
          return await handleAddSpeciesSynonym(args as AddSpeciesSynonymArgs);
        case "update_species_synonym":
          return await handleUpdateSpeciesSynonym(args as UpdateSpeciesSynonymArgs);
        case "delete_species_synonym":
          return await handleDeleteSpeciesSynonym(args as DeleteSpeciesSynonymArgs);
        case "list_common_names_by_text":
          return await handleListCommonNamesByText(args as ListCommonNamesByTextArgs);
        case "delete_common_name_by_id":
          return await handleDeleteCommonNameById(args as DeleteCommonNameByIdArgs);
        case "bulk_delete_common_names":
          return await handleBulkDeleteCommonNames(args as BulkDeleteCommonNamesArgs);
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

async function handleCreateSpeciesGroup(args: CreateSpeciesGroupArgs) {
  const {
    program_class,
    canonical_genus,
    canonical_species_name,
    species_type,
    base_points,
    is_cares_species,
  } = args;

  const group_id = await createSpeciesGroup({
    programClass: program_class,
    speciesType: species_type,
    canonicalGenus: canonical_genus,
    canonicalSpeciesName: canonical_species_name,
    basePoints: base_points,
    isCaresSpecies: is_cares_species,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            group_id,
            message: "Species group created successfully",
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleUpdateSpeciesGroup(args: UpdateSpeciesGroupArgs) {
  const { group_id, program_class, base_points, is_cares_species, external_references, image_links } = args;

  const changes = await updateSpeciesGroup(group_id, {
    programClass: program_class,
    basePoints: base_points,
    isCaresSpecies: is_cares_species,
    externalReferences: external_references,
    imageLinks: image_links,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            group_id,
            changes,
            updated_fields: Object.keys(args).filter((k) => k !== "group_id"),
            message: changes > 0 ? "Species group updated successfully" : "Species group not found",
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleDeleteSpeciesGroup(args: DeleteSpeciesGroupArgs) {
  const { group_id, force } = args;

  const changes = await deleteSpeciesGroup(group_id, force);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            group_id,
            changes,
            message: changes > 0 ? "Species group deleted successfully" : "Species group not found",
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleAddSpeciesSynonym(args: AddSpeciesSynonymArgs) {
  const { group_id, common_name, scientific_name } = args;

  const name_id = await addSynonym(group_id, common_name, scientific_name);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            name_id,
            group_id,
            message: "Synonym added successfully",
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleUpdateSpeciesSynonym(args: UpdateSpeciesSynonymArgs) {
  const { name_id, common_name, scientific_name } = args;

  const changes = await updateSynonym(name_id, {
    commonName: common_name,
    scientificName: scientific_name,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            name_id,
            changes,
            message: changes > 0 ? "Synonym updated successfully" : "Synonym not found",
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleDeleteSpeciesSynonym(args: DeleteSpeciesSynonymArgs) {
  const { name_id, force } = args;

  const changes = await deleteSynonym(name_id, force);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            name_id,
            changes,
            message: changes > 0 ? "Synonym deleted successfully" : "Synonym not found",
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleListCommonNamesByText(args: ListCommonNamesByTextArgs) {
  const { common_name, limit } = args;

  const results = await getCommonNamesByText(common_name, limit);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            common_name,
            count: results.length,
            results,
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleDeleteCommonNameById(args: DeleteCommonNameByIdArgs) {
  const { common_name_id } = args;

  const changes = await deleteCommonName(common_name_id);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            common_name_id,
            changes,
            message: changes > 0 ? "Common name deleted successfully" : "Common name not found",
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleBulkDeleteCommonNames(args: BulkDeleteCommonNamesArgs) {
  const { common_name, common_name_ids, preview = false } = args;

  // Validate that we have either common_name or common_name_ids
  if (!common_name && !common_name_ids) {
    throw new Error("Must provide either 'common_name' or 'common_name_ids'");
  }

  if (common_name && common_name_ids) {
    throw new Error("Cannot provide both 'common_name' and 'common_name_ids'");
  }

  const options = common_name ? { commonName: common_name } : { commonNameIds: common_name_ids! };
  const result = await bulkDeleteCommonNames(options, preview);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            preview,
            count: result.count,
            ...(result.preview && { preview_results: result.preview }),
            message: preview
              ? `Preview: Would delete ${result.count} common name(s)`
              : `Deleted ${result.count} common name(s)`,
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleMergeSpeciesGroups(args: MergeSpeciesGroupsArgs) {
  const { canonical_group_id, defunct_group_id, preview } = args;

  if (canonical_group_id === defunct_group_id) {
    throw new Error("Cannot merge a species with itself");
  }

  // Get both groups
  const groups = await query<SpeciesNameGroup>(
    "SELECT * FROM species_name_group WHERE group_id IN (?, ?)",
    [canonical_group_id, defunct_group_id]
  );

  if (groups.length !== 2) {
    throw new Error("One or both species groups not found");
  }

  const canonical = groups.find((g) => g.group_id === canonical_group_id);
  const defunct = groups.find((g) => g.group_id === defunct_group_id);

  // Get synonyms to move (from both split tables)
  const commonNamesToMove = await query<{ common_name_id: number; common_name: string }>(
    "SELECT * FROM species_common_name WHERE group_id = ?",
    [defunct_group_id]
  );
  const scientificNamesToMove = await query<{ scientific_name_id: number; scientific_name: string }>(
    "SELECT * FROM species_scientific_name WHERE group_id = ?",
    [defunct_group_id]
  );

  // Get submissions that will be updated
  const submissionsToUpdate = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM submissions WHERE common_name_id IN (SELECT common_name_id FROM species_common_name WHERE group_id = ?) OR scientific_name_id IN (SELECT scientific_name_id FROM species_scientific_name WHERE group_id = ?)",
    [defunct_group_id, defunct_group_id]
  );

  const previewData = {
    canonical_name: `${canonical?.canonical_genus} ${canonical?.canonical_species_name}`,
    defunct_name: `${defunct?.canonical_genus} ${defunct?.canonical_species_name}`,
    common_names_to_move: commonNamesToMove.map((s) => s.common_name),
    scientific_names_to_move: scientificNamesToMove.map((s) => s.scientific_name),
    submissions_to_update: submissionsToUpdate[0]?.count || 0,
  };

  if (preview) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              preview: true,
              canonical_group_id,
              defunct_group_id,
              common_names_moved: commonNamesToMove.length,
              scientific_names_moved: scientificNamesToMove.length,
              submissions_updated: previewData.submissions_to_update,
              preview_data: previewData,
              message: "Preview of merge operation (no changes made)",
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Execute merge
  await withTransaction(async (db) => {
    // Update common names
    const updateCommonStmt = await db.prepare(`
      UPDATE species_common_name
      SET group_id = ?
      WHERE group_id = ?
    `);
    await updateCommonStmt.run(canonical_group_id, defunct_group_id);
    await updateCommonStmt.finalize();

    // Update scientific names
    const updateScientificStmt = await db.prepare(`
      UPDATE species_scientific_name
      SET group_id = ?
      WHERE group_id = ?
    `);
    await updateScientificStmt.run(canonical_group_id, defunct_group_id);
    await updateScientificStmt.finalize();

    // Delete defunct group
    const deleteStmt = await db.prepare(`
      DELETE FROM species_name_group
      WHERE group_id = ?
    `);
    await deleteStmt.run(defunct_group_id);
    await deleteStmt.finalize();
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            canonical_group_id,
            defunct_group_id,
            common_names_moved: commonNamesToMove.length,
            scientific_names_moved: scientificNamesToMove.length,
            submissions_updated: previewData.submissions_to_update,
            preview_data: previewData,
            message: "Species groups merged successfully",
          },
          null,
          2
        ),
      },
    ],
  };
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

  const result = await getSpeciesForAdmin(filters, sort_by as "name" | "points" | "class" | undefined, limit, offset);

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
              synonym_count: s.synonym_count,
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

  const speciesDetail = await getSpeciesDetail(group_id);

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

  // Determine which species to update
  let targetGroupIds: number[] = [];

  if (group_id) {
    targetGroupIds = [group_id];
  } else if (group_ids && group_ids.length > 0) {
    targetGroupIds = group_ids;
  } else if (species_type || program_class) {
    // Query to get group_ids matching filters
    const filters: SpeciesAdminFilters = { species_type, program_class };
    const result = await getSpeciesForAdmin(filters, "name", 10000, 0);
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

  // Get preview data
  const affected = await query<{
    group_id: number;
    canonical_genus: string;
    canonical_species_name: string;
    base_points: number | null;
  }>(
    `SELECT group_id, canonical_genus, canonical_species_name, base_points
     FROM species_name_group
     WHERE group_id IN (${targetGroupIds.map(() => "?").join(", ")})`,
    targetGroupIds
  );

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

  const changes = await bulkSetPoints(targetGroupIds, base_points);

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

  const changes = await updateSpeciesGroup(group_id, {
    isCaresSpecies: is_cares_species,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            group_id,
            changes,
            is_cares_species,
            message: changes > 0 ? "CARES status updated" : "Species group not found",
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleUpdateCanonicalName(args: UpdateCanonicalNameArgs) {
  const {
    group_id,
    new_canonical_genus,
    new_canonical_species_name,
    preserve_old_as_synonym = true,
  } = args;

  if (!new_canonical_genus && !new_canonical_species_name) {
    throw new Error("At least one new field must be provided");
  }

  const groups = await query<SpeciesNameGroup>(
    "SELECT * FROM species_name_group WHERE group_id = ?",
    [group_id]
  );

  if (groups.length === 0) {
    throw new Error(`Species group ${group_id} not found`);
  }

  const oldGroup = groups[0];
  const oldCanonicalName = `${oldGroup.canonical_genus} ${oldGroup.canonical_species_name}`;

  await withTransaction(async (db) => {
    // Update canonical name
    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (new_canonical_genus) {
      updates.push("canonical_genus = ?");
      values.push(new_canonical_genus.trim());
    }
    if (new_canonical_species_name) {
      updates.push("canonical_species_name = ?");
      values.push(new_canonical_species_name.trim());
    }

    values.push(group_id);

    const updateStmt = await db.prepare(`
      UPDATE species_name_group
      SET ${updates.join(", ")}
      WHERE group_id = ?
    `);
    await updateStmt.run(...values);
    await updateStmt.finalize();

    // Create synonym with old name in both split tables
    if (preserve_old_as_synonym) {
      const oldName = `${oldGroup.canonical_genus} ${oldGroup.canonical_species_name}`;

      // Insert into species_common_name
      const insertCommonStmt = await db.prepare(`
        INSERT INTO species_common_name (group_id, common_name)
        VALUES (?, ?)
      `);
      await insertCommonStmt.run(group_id, oldName);
      await insertCommonStmt.finalize();

      // Insert into species_scientific_name
      const insertScientificStmt = await db.prepare(`
        INSERT INTO species_scientific_name (group_id, scientific_name)
        VALUES (?, ?)
      `);
      await insertScientificStmt.run(group_id, oldName);
      await insertScientificStmt.finalize();
    }
  });

  const newCanonicalName = `${new_canonical_genus || oldGroup.canonical_genus} ${new_canonical_species_name || oldGroup.canonical_species_name}`;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            group_id,
            old_canonical_name: oldCanonicalName,
            new_canonical_name: newCanonicalName,
            synonym_created: preserve_old_as_synonym,
            message: preserve_old_as_synonym
              ? "Canonical name updated, old name preserved as synonym"
              : "Canonical name updated",
          },
          null,
          2
        ),
      },
    ],
  };
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
    const species = await query<{ group_id: number; canonical_genus: string; canonical_species_name: string }>(
      "SELECT group_id, canonical_genus, canonical_species_name FROM species_name_group WHERE group_id = ?",
      [group_id]
    );
    if (species.length === 0) {
      throw new Error(`Species group ${group_id} not found`);
    }
    targetSpecies = species;
  } else if (group_ids && group_ids.length > 0) {
    targetSpecies = await query<{ group_id: number; canonical_genus: string; canonical_species_name: string }>(
      `SELECT group_id, canonical_genus, canonical_species_name FROM species_name_group WHERE group_id IN (${group_ids.map(() => "?").join(", ")})`,
      group_ids
    );
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
