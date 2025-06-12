import { Response } from "express";
import { MulmRequest } from "@/sessions";
import { 
	getSpeciesForExplorer, 
	getSpeciesDetail, 
	getBreedersForSpecies, 
	getFilterOptions,
	SpeciesFilters 
} from "@/db/species";
import { getClassOptions } from "@/forms/submission";
import { getQueryString } from "@/utils/request";

export async function explorer(req: MulmRequest, res: Response) {
	const { viewer } = req;
	const isLoggedIn = Boolean(viewer);

	const filters: SpeciesFilters = {
		species_type: getQueryString(req, 'species_type') || undefined,
		species_class: getQueryString(req, 'species_class') || undefined,
		search: getQueryString(req, 'search') || undefined,
		sort: (getQueryString(req, 'sort') as 'name' | 'reports' | 'breeders') || 'reports'
	};

	try {
		const [species, filterOptions] = await Promise.all([
			getSpeciesForExplorer(filters),
			getFilterOptions()
		]);

		const classOptions = filters.species_type ? getClassOptions(filters.species_type) : [];

		res.render("species/explorer", {
			title: "Species Explorer - BAS BAP/HAP Portal",
			isLoggedIn,
			species,
			filters,
			filterOptions,
			classOptions,
			totalSpecies: species.length
		});
	} catch (error) {
		console.error("Error loading species explorer:", error);
		res.status(500).render("error", {
			title: "Error - BAS BAP/HAP Portal",
			isLoggedIn,
			message: "Unable to load species data"
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
			message: "Species not found"
		});
		return;
	}

	try {
		const [speciesDetail, breeders] = await Promise.all([
			getSpeciesDetail(groupId),
			getBreedersForSpecies(groupId)
		]);

		if (!speciesDetail) {
			res.status(404).render("error", {
				title: "Species Not Found - BAS BAP/HAP Portal",
				isLoggedIn,
				message: "Species not found"
			});
			return;
		}

		const displayName = `${speciesDetail.canonical_genus} ${speciesDetail.canonical_species_name}`;
		
		res.render("species/detail", {
			title: `${displayName} - Species Explorer`,
			isLoggedIn,
			species: speciesDetail,
			breeders,
			displayName,
			totalBreeds: breeders.reduce((sum, breeder) => sum + breeder.breed_count, 0),
			totalBreeders: breeders.length
		});
	} catch (error) {
		console.error("Error loading species detail:", error);
		res.status(500).render("error", {
			title: "Error - BAS BAP/HAP Portal",
			isLoggedIn,
			message: "Unable to load species data"
		});
	}
}

export async function searchApi(req: MulmRequest, res: Response) {
	// Support both 'q' (for typeahead) and 'search' (for explorer) parameters
	const query = getQueryString(req, 'q') || getQueryString(req, 'search') || '';
	
	const filters: SpeciesFilters = {
		species_type: getQueryString(req, 'species_type') || undefined,
		species_class: getQueryString(req, 'species_class') || undefined,
		search: query,
		sort: (getQueryString(req, 'sort') as 'name' | 'reports' | 'breeders') || 'reports'
	};

	try {
		const species = await getSpeciesForExplorer(filters);
		
		// For typeahead compatibility, if 'q' parameter is used, return formatted array
		if (getQueryString(req, 'q')) {
			const formattedSpecies = species.slice(0, 10).map(s => ({
				value: s.group_id.toString(),
				text: `${s.canonical_genus} ${s.canonical_species_name}`,
				common_name: s.common_names?.split(',')[0] || '',
				scientific_name: `${s.canonical_genus} ${s.canonical_species_name}`,
				program_class: s.program_class,
				group_id: s.group_id
			}));
			res.json(formattedSpecies);
		} else {
			// For explorer compatibility, return full format
			res.json({
				species,
				totalSpecies: species.length
			});
		}
	} catch (error) {
		console.error("Error in species search API:", error);
		res.status(500).json({ error: "Unable to search species" });
	}
}