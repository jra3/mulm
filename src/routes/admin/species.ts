import { Response } from 'express';
import { MulmRequest } from '@/sessions';
import {
  getSpeciesForAdmin,
  SpeciesAdminFilters,
  getSpeciesDetail
} from '@/db/species';
import { getQueryString, getQueryNumber, getQueryBoolean, getBodyString } from '@/utils/request';
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

  // Get split names (common and scientific separately)
  const { getNamesForGroup } = await import('@/db/species');
  const names = await getNamesForGroup(groupId);

  // Get class options for this species type
  const { speciesTypesAndClasses } = await import('@/forms/submission');
  const classOptions = speciesTypesAndClasses[speciesDetail.species_type || 'Fish'] || [];

  res.render('admin/speciesEdit', {
    title: 'Edit Species',
    species: speciesDetail,
    commonNames: names.common_names,
    scientificNames: names.scientific_names,
    classOptions,
    speciesTypes: ['Fish', 'Plant', 'Invert', 'Coral'],
    errors: new Map()
  });
};

/**
 * PATCH /admin/species/:groupId
 * Update species group metadata
 */
export const updateSpecies = async (req: MulmRequest, res: Response) => {
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

  // Import form validation
  const { speciesEditForm } = await import('@/forms/speciesEdit');

  // Validate form data
  const parsed = speciesEditForm.safeParse(req.body);

  if (!parsed.success) {
    // Re-render form with errors
    const speciesDetail = await getSpeciesDetail(groupId);
    if (!speciesDetail) {
      res.status(404).send('Species not found');
      return;
    }

    const errors = new Map<string, string>();
    parsed.error.issues.forEach((issue) => {
      errors.set(String(issue.path[0]), issue.message);
    });

    res.render('admin/speciesEdit', {
      title: 'Edit Species',
      species: { ...speciesDetail, ...req.body as Record<string, unknown> },
      errors
    });
    return;
  }

  const { canonical_genus, canonical_species_name, program_class, base_points, is_cares_species, external_references, image_links } = parsed.data;

  // Update species group
  const { updateSpeciesGroup } = await import('@/db/species');

  try {
    const changes = await updateSpeciesGroup(groupId, {
      canonicalGenus: canonical_genus,
      canonicalSpeciesName: canonical_species_name,
      programClass: program_class,
      basePoints: base_points,
      isCaresSpecies: is_cares_species,
      externalReferences: external_references,
      imageLinks: image_links
    });

    if (changes === 0) {
      res.status(404).send('Species not found');
      return;
    }

    // Success - redirect back to list
    res.set('HX-Redirect', '/admin/species').status(200).send();
  } catch (err) {
    // Handle errors (e.g., duplicate canonical name)
    const speciesDetail = await getSpeciesDetail(groupId);
    const errors = new Map<string, string>();

    if (err instanceof Error && err.message.includes('already exists')) {
      errors.set('canonical_genus', err.message);
    } else {
      errors.set('_general', 'Failed to update species');
    }

    res.render('admin/speciesEdit', {
      title: 'Edit Species',
      species: { ...speciesDetail, ...req.body as Record<string, unknown> },
      errors
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
    res.status(403).send('Admin access required');
    return;
  }

  const groupId = parseInt(req.params.groupId);
  if (!groupId) {
    res.status(400).send('Invalid species ID');
    return;
  }

  const { deleteSpeciesGroup } = await import('@/db/species');

  try {
    // Check query param for force flag
    const force = req.query.force === 'true';
    const changes = await deleteSpeciesGroup(groupId, force);

    if (changes === 0) {
      res.status(404).send('Species not found');
      return;
    }

    res.status(200).send('Species deleted');
  } catch (err) {
    if (err instanceof Error && err.message.includes('approved submissions')) {
      res.status(400).send(err.message);
    } else {
      res.status(500).send('Failed to delete species');
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
    res.status(403).send('Admin access required');
    return;
  }

  const commonNameId = parseInt(req.params.commonNameId);
  if (!commonNameId) {
    res.status(400).send('Invalid common name ID');
    return;
  }

  const { deleteCommonName } = await import('@/db/species');

  try {
    const changes = await deleteCommonName(commonNameId);

    if (changes === 0) {
      res.status(404).send('Common name not found');
      return;
    }

    res.status(200).send('Common name deleted');
  } catch {
    res.status(500).send('Failed to delete common name');
  }
};

/**
 * DELETE /admin/species/:groupId/scientific-names/:scientificNameId
 * Delete a scientific name
 */
export const deleteScientificNameRoute = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send('Admin access required');
    return;
  }

  const scientificNameId = parseInt(req.params.scientificNameId);
  if (!scientificNameId) {
    res.status(400).send('Invalid scientific name ID');
    return;
  }

  const { deleteScientificName } = await import('@/db/species');

  try {
    const changes = await deleteScientificName(scientificNameId);

    if (changes === 0) {
      res.status(404).send('Scientific name not found');
      return;
    }

    res.status(200).send('Scientific name deleted');
  } catch {
    res.status(500).send('Failed to delete scientific name');
  }
};

/**
 * DEPRECATED: DELETE /admin/species/:groupId/synonyms/:nameId
 * Delete a synonym (old paired table)
 */
export const deleteSynonym = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send('Admin access required');
    return;
  }

  const nameId = parseInt(req.params.nameId);
  if (!nameId) {
    res.status(400).send('Invalid synonym ID');
    return;
  }

  const { deleteSynonym } = await import('@/db/species');

  try {
    const force = req.query.force === 'true';
    const changes = await deleteSynonym(nameId, force);

    if (changes === 0) {
      res.status(404).send('Synonym not found');
      return;
    }

    res.status(200).send('Synonym deleted');
  } catch (err) {
    if (err instanceof Error && err.message.includes('last synonym')) {
      res.status(400).send(err.message);
    } else {
      res.status(500).send('Failed to delete synonym');
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
    res.status(403).send('Admin access required');
    return;
  }

  const groupId = parseInt(req.params.groupId);
  if (!groupId) {
    res.status(400).send('Invalid species ID');
    return;
  }

  const common_name = getBodyString(req, 'common_name');

  const { addCommonName } = await import('@/db/species');

  try {
    const commonNameId = await addCommonName(groupId, common_name);

    // Return HTML for new common name row
    res.render('admin/commonNameRow', {
      name: {
        common_name_id: commonNameId,
        common_name: common_name.trim()
      },
      groupId
    });
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).send(err.message);
    } else {
      res.status(500).send('Failed to add common name');
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
    res.status(403).send('Admin access required');
    return;
  }

  const groupId = parseInt(req.params.groupId);
  if (!groupId) {
    res.status(400).send('Invalid species ID');
    return;
  }

  const scientific_name = getBodyString(req, 'scientific_name');

  const { addScientificName } = await import('@/db/species');

  try {
    const scientificNameId = await addScientificName(groupId, scientific_name);

    // Return HTML for new scientific name row
    res.render('admin/scientificNameRow', {
      name: {
        scientific_name_id: scientificNameId,
        scientific_name: scientific_name.trim()
      },
      groupId
    });
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).send(err.message);
    } else {
      res.status(500).send('Failed to add scientific name');
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
    res.status(403).send('Admin access required');
    return;
  }

  const groupId = parseInt(req.params.groupId);

  res.render('admin/addCommonNameForm', { groupId });
};

/**
 * GET /admin/species/:groupId/scientific-names/new
 * Render add scientific name form (HTMX partial)
 */
export const addScientificNameForm = (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  if (!viewer?.is_admin) {
    res.status(403).send('Admin access required');
    return;
  }

  const groupId = parseInt(req.params.groupId);

  res.render('admin/addScientificNameForm', { groupId });
};

/**
 * DEPRECATED: POST /admin/species/:groupId/synonyms
 * Add a new paired synonym (old schema)
 */
export const addSynonymRoute = async (req: MulmRequest, res: Response) => {
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

  const common_name = getBodyString(req, 'common_name');
  const scientific_name = getBodyString(req, 'scientific_name');

  const { addSynonym } = await import('@/db/species');

  try {
    const nameId = await addSynonym(groupId, common_name, scientific_name);

    // Return the new synonym HTML to be appended
    res.render('admin/synonymRow', {
      synonym: {
        name_id: nameId,
        common_name: common_name.trim(),
        scientific_name: scientific_name.trim()
      },
      groupId
    });
  } catch (err) {
    if (err instanceof Error) {
      res.status(400).send(err.message);
    } else {
      res.status(500).send('Failed to add synonym');
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
    res.status(403).send('Admin access required');
    return;
  }

  const groupId = parseInt(req.params.groupId);

  res.render('admin/addSynonymForm', {
    groupId,
    errors: new Map()
  });
};
