import { Response } from "express";
import { MulmRequest } from "@/sessions";
import {
  getSpeciesForExplorer,
  getSpeciesDetail,
  getBreedersForSpecies,
  getFilterOptions,
  getNamesForGroup,
  SpeciesFilters,
} from "@/db/species";
import { getSpeciesKeepers } from "@/db/collection";
import { getClassOptions } from "@/forms/submission";
import { speciesExplorerQuerySchema } from "@/forms/species-explorer";
import { validateQueryWithFallback } from "@/forms/utils";
import { logger } from "@/utils/logger";

export async function explorer(req: MulmRequest, res: Response) {
  const { viewer } = req;
  const isLoggedIn = Boolean(viewer);

  const validation = validateQueryWithFallback(
    speciesExplorerQuerySchema,
    req.query,
    "Species explorer query"
  );

  const filters: SpeciesFilters = {
    species_type: validation.data.species_type,
    species_class: validation.data.species_class,
    search: validation.data.search,
    sort: validation.data.sort,
  };

  try {
    const [species, filterOptions] = await Promise.all([
      getSpeciesForExplorer(filters),
      getFilterOptions(),
    ]);

    const classOptions = filters.species_type ? getClassOptions(filters.species_type) : [];

    res.render("species/explorer", {
      title: "Species Explorer - BAS BAP/HAP Portal",
      isLoggedIn,
      species,
      filters,
      filterOptions,
      classOptions,
      totalSpecies: species.length,
      validationErrors: validation.errors,
    });
  } catch (error) {
    logger.error("Error loading species explorer", error);
    res.status(500).render("error", {
      title: "Error - BAS BAP/HAP Portal",
      isLoggedIn,
      message: "Unable to load species data",
    });
  }
}

export async function detail(req: MulmRequest, res: Response) {
  const { viewer } = req;
  const isLoggedIn = Boolean(viewer);
  const groupId = parseInt(req.params.groupId);

  if (isNaN(groupId)) {
    res.status(404).render("error", {
      title: "Species Not Found - BAS BAP/HAP Portal",
      isLoggedIn,
      message: "Species not found",
    });
    return;
  }

  try {
    const [speciesDetail, breeders, names, keepers] = await Promise.all([
      getSpeciesDetail(groupId),
      getBreedersForSpecies(groupId),
      getNamesForGroup(groupId),
      getSpeciesKeepers(groupId),
    ]);

    if (!speciesDetail) {
      res.status(404).render("error", {
        title: "Species Not Found - BAS BAP/HAP Portal",
        isLoggedIn,
        message: "Species not found",
      });
      return;
    }

    const displayName = `${speciesDetail.canonical_genus} ${speciesDetail.canonical_species_name}`;

    res.render("species/detail", {
      title: `${displayName} - Species Explorer`,
      isLoggedIn,
      species: speciesDetail,
      breeders,
      commonNames: names.common_names,
      scientificNames: names.scientific_names,
      displayName,
      totalBreeds: breeders.reduce((sum, breeder) => sum + breeder.breed_count, 0),
      totalBreeders: breeders.length,
      keeperCount: keepers.count,
      keepers: keepers.members,
    });
  } catch (error) {
    logger.error("Error loading species detail", error);
    res.status(500).render("error", {
      title: "Error - BAS BAP/HAP Portal",
      isLoggedIn,
      message: "Unable to load species data",
    });
  }
}
