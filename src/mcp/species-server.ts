#!/usr/bin/env node

/**
 * Species Database MCP Server
 *
 * Provides Model Context Protocol tools and resources for managing
 * the species database (species_name_group and species_name tables).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { query, withTransaction } from '../db/conn.js';
import { logger } from '../utils/logger.js';
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
  bulkSetPoints
} from '../db/species.js';

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

type SpeciesName = {
  name_id: number;
  group_id: number;
  common_name: string;
  scientific_name: string;
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

// Create MCP server
const server = new Server(
  {
    name: 'species-database',
    version: '1.0.0',
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

/**
 * LIST RESOURCES HANDLER
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'species://groups/list',
        name: 'All Species Groups',
        description: 'List all species groups with basic information',
        mimeType: 'application/json',
      },
      {
        uri: 'species://groups/by-type/Fish',
        name: 'Fish Species',
        description: 'List all fish species',
        mimeType: 'application/json',
      },
      {
        uri: 'species://groups/by-type/Plant',
        name: 'Plant Species',
        description: 'List all plant species',
        mimeType: 'application/json',
      },
      {
        uri: 'species://groups/by-type/Invert',
        name: 'Invertebrate Species',
        description: 'List all invertebrate species',
        mimeType: 'application/json',
      },
      {
        uri: 'species://groups/by-type/Coral',
        name: 'Coral Species',
        description: 'List all coral species',
        mimeType: 'application/json',
      },
      {
        uri: 'species://groups/cares',
        name: 'CARES Species',
        description: 'List all CARES conservation priority species',
        mimeType: 'application/json',
      },
      {
        uri: 'species://statistics',
        name: 'Species Statistics',
        description: 'Get aggregate statistics about the species database',
        mimeType: 'application/json',
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
    if (uri === 'species://groups/list') {
      const groups = await query<SpeciesNameGroup>(`
        SELECT * FROM species_name_group
        ORDER BY canonical_genus, canonical_species_name
      `);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
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
        'SELECT * FROM species_name_group WHERE group_id = ?',
        [groupId]
      );
      if (groups.length === 0) {
        throw new Error(`Species group ${groupId} not found`);
      }
      const synonyms = await query<SpeciesName>(
        'SELECT * FROM species_name WHERE group_id = ? ORDER BY common_name',
        [groupId]
      );
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
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
        'SELECT * FROM species_name_group WHERE species_type = ? ORDER BY canonical_genus, canonical_species_name',
        [speciesType]
      );
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
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
        'SELECT * FROM species_name_group WHERE program_class = ? ORDER BY canonical_genus, canonical_species_name',
        [programClass]
      );
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(groups.map(formatSpeciesGroup), null, 2),
          },
        ],
      };
    }

    // species://groups/cares
    if (uri === 'species://groups/cares') {
      const groups = await query<SpeciesNameGroup>(
        'SELECT * FROM species_name_group WHERE is_cares_species = 1 ORDER BY canonical_genus, canonical_species_name'
      );
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(groups.map(formatSpeciesGroup), null, 2),
          },
        ],
      };
    }

    // species://names/{name_id}
    const nameMatch = uri.match(/^species:\/\/names\/(\d+)$/);
    if (nameMatch) {
      const nameId = parseInt(nameMatch[1]);
      const names = await query<SpeciesName & { program_class: string; canonical_genus: string; canonical_species_name: string; species_type: string }>(
        `SELECT sn.*, sng.program_class, sng.canonical_genus, sng.canonical_species_name, sng.species_type
         FROM species_name sn
         JOIN species_name_group sng ON sn.group_id = sng.group_id
         WHERE sn.name_id = ?`,
        [nameId]
      );
      if (names.length === 0) {
        throw new Error(`Species name ${nameId} not found`);
      }
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
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
            mimeType: 'application/json',
            text: JSON.stringify(names, null, 2),
          },
        ],
      };
    }

    // species://statistics
    if (uri === 'species://statistics') {
      const totalCount = await query<{ count: number }>('SELECT COUNT(*) as count FROM species_name_group');

      const byType = await query<{ species_type: string; count: number }>(
        'SELECT species_type, COUNT(*) as count FROM species_name_group GROUP BY species_type ORDER BY species_type'
      );

      const byClass = await query<{ program_class: string; count: number }>(
        'SELECT program_class, COUNT(*) as count FROM species_name_group GROUP BY program_class ORDER BY count DESC LIMIT 10'
      );

      const caresCount = await query<{ count: number }>(
        'SELECT COUNT(*) as count FROM species_name_group WHERE is_cares_species = 1'
      );

      const withPoints = await query<{ count: number }>(
        'SELECT COUNT(*) as count FROM species_name_group WHERE base_points IS NOT NULL'
      );

      const withoutPoints = await query<{ count: number }>(
        'SELECT COUNT(*) as count FROM species_name_group WHERE base_points IS NULL'
      );

      const statistics = {
        total_species: totalCount[0].count,
        by_type: Object.fromEntries(byType.map(t => [t.species_type, t.count])),
        top_program_classes: byClass.map(c => ({ program_class: c.program_class, count: c.count })),
        cares_species: caresCount[0].count,
        with_base_points: withPoints[0].count,
        without_base_points: withoutPoints[0].count,
      };

      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(statistics, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
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
        name: 'create_species_group',
        description: 'Creates a new species group with canonical taxonomic name',
        inputSchema: {
          type: 'object',
          properties: {
            program_class: { type: 'string', description: 'BAP program class (e.g., Cichlids, Livebearers)' },
            canonical_genus: { type: 'string', description: 'Official genus name' },
            canonical_species_name: { type: 'string', description: 'Official species name' },
            species_type: { type: 'string', enum: ['Fish', 'Plant', 'Invert', 'Coral'], description: 'High-level category' },
            base_points: { type: 'number', description: 'Points awarded for breeding (optional)' },
            is_cares_species: { type: 'boolean', description: 'CARES conservation species (optional, default: false)' },
          },
          required: ['program_class', 'canonical_genus', 'canonical_species_name', 'species_type'],
        },
      },
      {
        name: 'update_species_group',
        description: 'Updates metadata for an existing species group',
        inputSchema: {
          type: 'object',
          properties: {
            group_id: { type: 'number', description: 'Species group ID' },
            base_points: { type: 'number', description: 'Points awarded for breeding' },
            is_cares_species: { type: 'boolean', description: 'CARES conservation species' },
            external_references: { type: 'array', items: { type: 'string' }, description: 'Array of reference URLs' },
            image_links: { type: 'array', items: { type: 'string' }, description: 'Array of image URLs' },
          },
          required: ['group_id'],
        },
      },
      {
        name: 'delete_species_group',
        description: 'Deletes a species group and all its name variants (DESTRUCTIVE)',
        inputSchema: {
          type: 'object',
          properties: {
            group_id: { type: 'number', description: 'Species group ID' },
            force: { type: 'boolean', description: 'Force delete even if submissions exist (default: false)' },
          },
          required: ['group_id'],
        },
      },
      {
        name: 'add_species_synonym',
        description: 'Adds a common name or scientific name variant to an existing species group',
        inputSchema: {
          type: 'object',
          properties: {
            group_id: { type: 'number', description: 'Species group ID' },
            common_name: { type: 'string', description: 'Common name variant' },
            scientific_name: { type: 'string', description: 'Scientific name variant' },
          },
          required: ['group_id', 'common_name', 'scientific_name'],
        },
      },
      {
        name: 'update_species_synonym',
        description: 'Updates an existing name variant',
        inputSchema: {
          type: 'object',
          properties: {
            name_id: { type: 'number', description: 'Name variant ID' },
            common_name: { type: 'string', description: 'Common name variant' },
            scientific_name: { type: 'string', description: 'Scientific name variant' },
          },
          required: ['name_id'],
        },
      },
      {
        name: 'delete_species_synonym',
        description: 'Removes a name variant from a species group',
        inputSchema: {
          type: 'object',
          properties: {
            name_id: { type: 'number', description: 'Name variant ID' },
            force: { type: 'boolean', description: 'Force delete even if last synonym (default: false)' },
          },
          required: ['name_id'],
        },
      },
      // Advanced Operations
      {
        name: 'merge_species_groups',
        description: 'Merges two species groups (moves synonyms and submissions from defunct to canonical)',
        inputSchema: {
          type: 'object',
          properties: {
            canonical_group_id: { type: 'number', description: 'Species group to keep' },
            defunct_group_id: { type: 'number', description: 'Species group to merge and delete' },
            preview: { type: 'boolean', description: 'Preview changes without executing (default: false)' },
          },
          required: ['canonical_group_id', 'defunct_group_id'],
        },
      },
      {
        name: 'search_species',
        description: 'Search species with filters and sorting',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search text (searches names and synonyms)' },
            species_type: { type: 'string', enum: ['Fish', 'Plant', 'Invert', 'Coral'], description: 'Filter by species type' },
            program_class: { type: 'string', description: 'Filter by program class' },
            has_base_points: { type: 'boolean', description: 'Filter by presence of base points' },
            is_cares_species: { type: 'boolean', description: 'Filter CARES species' },
            sort_by: { type: 'string', enum: ['name', 'points', 'class'], description: 'Sort order (default: name)' },
            limit: { type: 'number', description: 'Max results (default: 100)' },
            offset: { type: 'number', description: 'Skip results (default: 0)' },
            count_only: { type: 'boolean', description: 'Return only the total count, not the results (default: false)' },
          },
        },
      },
      {
        name: 'get_species_detail',
        description: 'Get comprehensive details for a single species including all synonyms',
        inputSchema: {
          type: 'object',
          properties: {
            group_id: { type: 'number', description: 'Species group ID' },
          },
          required: ['group_id'],
        },
      },
      {
        name: 'set_base_points',
        description: 'Update point values for species (individual or bulk)',
        inputSchema: {
          type: 'object',
          properties: {
            group_id: { type: 'number', description: 'Single species group ID (optional)' },
            group_ids: { type: 'array', items: { type: 'number' }, description: 'Multiple species group IDs (optional)' },
            species_type: { type: 'string', description: 'Filter by species type (optional)' },
            program_class: { type: 'string', description: 'Filter by program class (optional)' },
            base_points: { type: 'number', description: 'Points value to set' },
            preview: { type: 'boolean', description: 'Preview changes without executing (default: false)' },
          },
          required: ['base_points'],
        },
      },
      {
        name: 'toggle_cares_status',
        description: 'Mark species as CARES conservation priority or remove CARES status',
        inputSchema: {
          type: 'object',
          properties: {
            group_id: { type: 'number', description: 'Species group ID' },
            is_cares_species: { type: 'boolean', description: 'CARES status' },
          },
          required: ['group_id', 'is_cares_species'],
        },
      },
      {
        name: 'update_canonical_name',
        description: 'Update the canonical genus and/or species name (for taxonomic revisions)',
        inputSchema: {
          type: 'object',
          properties: {
            group_id: { type: 'number', description: 'Species group ID' },
            new_canonical_genus: { type: 'string', description: 'New genus name (optional)' },
            new_canonical_species_name: { type: 'string', description: 'New species name (optional)' },
            preserve_old_as_synonym: { type: 'boolean', description: 'Create synonym with old name (default: true)' },
          },
          required: ['group_id'],
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
      case 'create_species_group':
        return await handleCreateSpeciesGroup(args);
      case 'update_species_group':
        return await handleUpdateSpeciesGroup(args);
      case 'delete_species_group':
        return await handleDeleteSpeciesGroup(args);
      case 'add_species_synonym':
        return await handleAddSpeciesSynonym(args);
      case 'update_species_synonym':
        return await handleUpdateSpeciesSynonym(args);
      case 'delete_species_synonym':
        return await handleDeleteSpeciesSynonym(args);
      case 'merge_species_groups':
        return await handleMergeSpeciesGroups(args);
      case 'search_species':
        return await handleSearchSpecies(args);
      case 'get_species_detail':
        return await handleGetSpeciesDetail(args);
      case 'set_base_points':
        return await handleSetBasePoints(args);
      case 'toggle_cares_status':
        return await handleToggleCaresStatus(args);
      case 'update_canonical_name':
        return await handleUpdateCanonicalName(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: message,
            error_code: 'TOOL_EXECUTION_ERROR',
          }, null, 2),
        },
      ],
    };
  }
});

/**
 * TOOL IMPLEMENTATIONS
 */

async function handleCreateSpeciesGroup(args: any) {
  const { program_class, canonical_genus, canonical_species_name, species_type, base_points, is_cares_species } = args;

  const group_id = await createSpeciesGroup({
    programClass: program_class,
    speciesType: species_type,
    canonicalGenus: canonical_genus,
    canonicalSpeciesName: canonical_species_name,
    basePoints: base_points,
    isCaresSpecies: is_cares_species
  });

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          group_id,
          message: 'Species group created successfully',
        }, null, 2),
      },
    ],
  };
}

async function handleUpdateSpeciesGroup(args: any) {
  const { group_id, base_points, is_cares_species, external_references, image_links } = args;

  const changes = await updateSpeciesGroup(group_id, {
    basePoints: base_points,
    isCaresSpecies: is_cares_species,
    externalReferences: external_references,
    imageLinks: image_links
  });

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          group_id,
          changes,
          updated_fields: Object.keys(args).filter(k => k !== 'group_id'),
          message: changes > 0 ? 'Species group updated successfully' : 'Species group not found',
        }, null, 2),
      },
    ],
  };
}

async function handleDeleteSpeciesGroup(args: any) {
  const { group_id, force } = args;

  const changes = await deleteSpeciesGroup(group_id, force);

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          group_id,
          changes,
          message: changes > 0 ? 'Species group deleted successfully' : 'Species group not found',
        }, null, 2),
      },
    ],
  };
}

async function handleAddSpeciesSynonym(args: any) {
  const { group_id, common_name, scientific_name } = args;

  const name_id = await addSynonym(group_id, common_name, scientific_name);

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          name_id,
          group_id,
          message: 'Synonym added successfully',
        }, null, 2),
      },
    ],
  };
}

async function handleUpdateSpeciesSynonym(args: any) {
  const { name_id, common_name, scientific_name } = args;

  const changes = await updateSynonym(name_id, {
    commonName: common_name,
    scientificName: scientific_name
  });

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          name_id,
          changes,
          message: changes > 0 ? 'Synonym updated successfully' : 'Synonym not found',
        }, null, 2),
      },
    ],
  };
}

async function handleDeleteSpeciesSynonym(args: any) {
  const { name_id, force } = args;

  const changes = await deleteSynonym(name_id, force);

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          name_id,
          changes,
          message: changes > 0 ? 'Synonym deleted successfully' : 'Synonym not found',
        }, null, 2),
      },
    ],
  };
}

async function handleMergeSpeciesGroups(args: any) {
  const { canonical_group_id, defunct_group_id, preview } = args;

  if (canonical_group_id === defunct_group_id) {
    throw new Error('Cannot merge a species with itself');
  }

  // Get both groups
  const groups = await query<SpeciesNameGroup>(
    'SELECT * FROM species_name_group WHERE group_id IN (?, ?)',
    [canonical_group_id, defunct_group_id]
  );

  if (groups.length !== 2) {
    throw new Error('One or both species groups not found');
  }

  const canonical = groups.find(g => g.group_id === canonical_group_id);
  const defunct = groups.find(g => g.group_id === defunct_group_id);

  // Get synonyms to move
  const synonymsToMove = await query<SpeciesName>(
    'SELECT * FROM species_name WHERE group_id = ?',
    [defunct_group_id]
  );

  // Get submissions that will be updated
  const submissionsToUpdate = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM submissions s JOIN species_name sn ON s.species_name_id = sn.name_id WHERE sn.group_id = ?',
    [defunct_group_id]
  );

  const previewData = {
    canonical_name: `${canonical?.canonical_genus} ${canonical?.canonical_species_name}`,
    defunct_name: `${defunct?.canonical_genus} ${defunct?.canonical_species_name}`,
    synonyms_to_move: synonymsToMove.map(s => `${s.common_name} (${s.scientific_name})`),
    submissions_to_update: submissionsToUpdate[0]?.count || 0,
  };

  if (preview) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            preview: true,
            canonical_group_id,
            defunct_group_id,
            synonyms_moved: synonymsToMove.length,
            submissions_updated: previewData.submissions_to_update,
            preview_data: previewData,
            message: 'Preview of merge operation (no changes made)',
          }, null, 2),
        },
      ],
    };
  }

  // Execute merge
  await withTransaction(async (db) => {
    // Update synonyms
    const updateStmt = await db.prepare(`
      UPDATE species_name
      SET group_id = ?
      WHERE group_id = ?
    `);
    await updateStmt.run(canonical_group_id, defunct_group_id);
    await updateStmt.finalize();

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
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          canonical_group_id,
          defunct_group_id,
          synonyms_moved: synonymsToMove.length,
          submissions_updated: previewData.submissions_to_update,
          preview_data: previewData,
          message: 'Species groups merged successfully',
        }, null, 2),
      },
    ],
  };
}

async function handleSearchSpecies(args: any) {
  const {
    query: searchQuery,
    species_type,
    program_class,
    has_base_points,
    is_cares_species,
    sort_by = 'name',
    limit = 100,
    offset = 0,
    count_only = false,
  } = args;

  const filters = {
    species_type,
    program_class,
    has_base_points,
    is_cares_species,
    search: searchQuery
  };

  const result = await getSpeciesForAdmin(filters, sort_by, limit, offset);

  // If count_only is true, return just the count
  if (count_only) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            total_count: result.total_count,
            count_only: true,
          }, null, 2),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          total_count: result.total_count,
          returned_count: result.species.length,
          results: result.species.map(s => ({
            group_id: s.group_id,
            program_class: s.program_class,
            canonical_genus: s.canonical_genus,
            canonical_species_name: s.canonical_species_name,
            species_type: s.species_type,
            base_points: s.base_points,
            is_cares_species: Boolean(s.is_cares_species),
            synonym_count: s.synonym_count,
          })),
        }, null, 2),
      },
    ],
  };
}

async function handleGetSpeciesDetail(args: any) {
  const { group_id } = args;

  const speciesDetail = await getSpeciesDetail(group_id);

  if (!speciesDetail) {
    throw new Error(`Species group ${group_id} not found`);
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          species: speciesDetail,
        }, null, 2),
      },
    ],
  };
}

async function handleSetBasePoints(args: any) {
  const { group_id, group_ids, species_type, program_class, base_points, preview } = args;

  // Determine which species to update
  let targetGroupIds: number[] = [];

  if (group_id) {
    targetGroupIds = [group_id];
  } else if (group_ids && group_ids.length > 0) {
    targetGroupIds = group_ids;
  } else if (species_type || program_class) {
    // Query to get group_ids matching filters
    const filters: any = { species_type, program_class };
    const result = await getSpeciesForAdmin(filters, 'name', 10000, 0);
    targetGroupIds = result.species.map(s => s.group_id);
  } else {
    throw new Error('Must provide group_id, group_ids, or species_type/program_class filter');
  }

  if (targetGroupIds.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            updated_count: 0,
            message: 'No species matched the criteria',
          }, null, 2),
        },
      ],
    };
  }

  // Get preview data
  const affected = await query<{ group_id: number; canonical_genus: string; canonical_species_name: string; base_points: number | null }>(
    `SELECT group_id, canonical_genus, canonical_species_name, base_points
     FROM species_name_group
     WHERE group_id IN (${targetGroupIds.map(() => '?').join(', ')})`,
    targetGroupIds
  );

  if (preview) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            preview: true,
            updated_count: affected.length,
            updated_species: affected.map(s => ({
              group_id: s.group_id,
              canonical_name: `${s.canonical_genus} ${s.canonical_species_name}`,
              old_points: s.base_points,
              new_points: base_points,
            })),
            message: 'Preview of base points update (no changes made)',
          }, null, 2),
        },
      ],
    };
  }

  const changes = await bulkSetPoints(targetGroupIds, base_points);

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          updated_count: changes,
          updated_species: affected.map(s => ({
            group_id: s.group_id,
            canonical_name: `${s.canonical_genus} ${s.canonical_species_name}`,
            old_points: s.base_points,
            new_points: base_points,
          })),
          message: `Base points updated for ${changes} species`,
        }, null, 2),
      },
    ],
  };
}

async function handleToggleCaresStatus(args: any) {
  const { group_id, is_cares_species } = args;

  const changes = await updateSpeciesGroup(group_id, {
    isCaresSpecies: is_cares_species
  });

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          group_id,
          changes,
          is_cares_species,
          message: changes > 0 ? 'CARES status updated' : 'Species group not found',
        }, null, 2),
      },
    ],
  };
}

async function handleUpdateCanonicalName(args: any) {
  const { group_id, new_canonical_genus, new_canonical_species_name, preserve_old_as_synonym = true } = args;

  if (!new_canonical_genus && !new_canonical_species_name) {
    throw new Error('At least one new field must be provided');
  }

  const groups = await query<SpeciesNameGroup>(
    'SELECT * FROM species_name_group WHERE group_id = ?',
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
    const values: any[] = [];

    if (new_canonical_genus) {
      updates.push('canonical_genus = ?');
      values.push(new_canonical_genus.trim());
    }
    if (new_canonical_species_name) {
      updates.push('canonical_species_name = ?');
      values.push(new_canonical_species_name.trim());
    }

    values.push(group_id);

    const updateStmt = await db.prepare(`
      UPDATE species_name_group
      SET ${updates.join(', ')}
      WHERE group_id = ?
    `);
    await updateStmt.run(...values);
    await updateStmt.finalize();

    // Create synonym with old name
    if (preserve_old_as_synonym) {
      const insertStmt = await db.prepare(`
        INSERT INTO species_name (group_id, common_name, scientific_name)
        VALUES (?, ?, ?)
      `);
      await insertStmt.run(
        group_id,
        `${oldGroup.canonical_genus} ${oldGroup.canonical_species_name}`,
        `${oldGroup.canonical_genus} ${oldGroup.canonical_species_name}`
      );
      await insertStmt.finalize();
    }
  });

  const newCanonicalName = `${new_canonical_genus || oldGroup.canonical_genus} ${new_canonical_species_name || oldGroup.canonical_species_name}`;

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          group_id,
          old_canonical_name: oldCanonicalName,
          new_canonical_name: newCanonicalName,
          synonym_created: preserve_old_as_synonym,
          message: preserve_old_as_synonym
            ? 'Canonical name updated, old name preserved as synonym'
            : 'Canonical name updated',
        }, null, 2),
      },
    ],
  };
}

/**
 * START SERVER
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Species Database MCP Server running on stdio');
}

main().catch((error) => {
  logger.error('Server error:', error);
  process.exit(1);
});
