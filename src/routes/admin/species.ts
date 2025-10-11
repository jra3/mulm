import { Response } from 'express';
import { MulmRequest } from '@/sessions';
import {
  getSpeciesForAdmin,
  SpeciesAdminFilters,
  getSpeciesDetail,
  getSynonymsForGroup
} from '@/db/species';
import { getQueryString, getQueryNumber, getQueryBoolean } from '@/utils/request';
import { getClassOptions } from '@/forms/submission';

/**
 * GET /admin/species
 * Admin species list with filters and pagination
 */
export const listSpecies = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send('Admin access required');
    return;
  }

  // Parse query parameters for filters
  const filters: SpeciesAdminFilters = {
    species_type: getQueryString(req, 'species_type'),
    program_class: getQueryString(req, 'species_class'),
    has_base_points: getQueryBoolean(req, 'has_points'),
    is_cares_species: getQueryBoolean(req, 'is_cares'),
    search: getQueryString(req, 'search')
  };

  const sort = (getQueryString(req, 'sort') as 'name' | 'points' | 'class') || 'name';
  const page = getQueryNumber(req, 'page') || 1;
  const limit = 50;
  const offset = (page - 1) * limit;

  // Get species data with synonyms
  const result = await getSpeciesForAdmin(filters, sort, limit, offset);

  // For each species, fetch their synonyms for the hovercard
  const { getSynonymsForGroup } = await import('@/db/species');
  const speciesWithSynonyms = await Promise.all(
    result.species.map(async (species) => {
      const synonyms = await getSynonymsForGroup(species.group_id);
      return {
        ...species,
        synonyms
      };
    })
  );

  // Calculate pagination
  const totalPages = Math.ceil(result.total_count / limit);

  // Get class options based on selected species type
  const selectedType = filters.species_type || 'Fish';
  const classOptions = getClassOptions(selectedType);

  res.render('admin/speciesList', {
    title: 'Species Management',
    species: speciesWithSynonyms,
    filters,
    sort,
    classOptions,
    speciesTypes: ['Fish', 'Plant', 'Invert', 'Coral'],
    pagination: {
      currentPage: page,
      totalPages,
      totalCount: result.total_count,
      limit
    }
  });
};

/**
 * GET /admin/species/:groupId/edit
 * Render edit sidebar for species (HTMX partial)
 */
export const editSpeciesSidebar = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send('Admin access required');
    return;
  }

  const groupId = parseInt(req.params.groupId);
  if (!groupId) {
    res.status(400).send('Invalid species ID');
    return;
  }

  const speciesDetail = await getSpeciesDetail(groupId);

  if (!speciesDetail) {
    res.status(404).send('Species not found');
    return;
  }

  // Get full species group data (getSpeciesDetail doesn't return all fields)
  const fullData = await getSynonymsForGroup(groupId);

  res.render('admin/speciesEditSidebar', {
    species: speciesDetail,
    errors: new Map()
  });
};
