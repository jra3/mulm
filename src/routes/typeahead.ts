import { Response } from 'express';
import { MulmRequest } from '@/sessions';
import { searchMembers as searchMembersDb } from '@/db/members';
import { searchSpeciesTypeahead } from '@/db/species';
import { getQueryString } from '@/utils/request';
import { speciesExplorerQuerySchema } from '@/forms/species-explorer';
import { validateQueryWithFallback } from '@/forms/utils';
import { sendApiErrors } from '@/utils/api-responses';
import { 
	MemberTypeaheadItem,
	SpeciesTypeaheadItem,
	ApiErrorResponse 
} from '@/types/api-responses';

/**
 * Search members for typeahead/autocomplete
 * GET /api/members/search?q=search_term
 */
export const searchMembers = async (req: MulmRequest, res: Response<MemberTypeaheadItem[] | ApiErrorResponse>) => {
    try {
        const query = getQueryString(req, 'q', '');
        
        // The database function handles the minimum length check and returns empty array if needed
        const members = await searchMembersDb(query);
        
        const formattedMembers: MemberTypeaheadItem[] = members.map(member => ({
            value: member.display_name,  // Using display name as value to match form field
            text: member.display_name,
            email: member.contact_email
        }));
        
        res.json(formattedMembers);
    } catch (error) {
        console.error("Error in member search API:", error);
        sendApiErrors.searchFailed(res, "members");
    }
};

/**
 * Search species for typeahead/autocomplete
 * GET /api/species/search?q=search_term
 */
export const searchSpecies = async (req: MulmRequest, res: Response<SpeciesTypeaheadItem[] | ApiErrorResponse>) => {
	try {
		const query = getQueryString(req, 'q', '');
		
		const queryObject = {
			...req.query,
			search: query
		};
		
		const validation = validateQueryWithFallback(
			speciesExplorerQuerySchema, 
			queryObject, 
			'Species typeahead search'
		);

		// Use the optimized typeahead function that limits at database level
		const species = await searchSpeciesTypeahead(
			query,
			{
				species_type: validation.data.species_type,
				species_class: validation.data.species_class
			},
			10 // Limit results for typeahead
		);
		
		const formattedSpecies: SpeciesTypeaheadItem[] = species.map(s => ({
			value: s.group_id.toString(),
			text: `${s.canonical_genus} ${s.canonical_species_name}`,
			common_name: s.common_names?.split(',')[0] || '',
			scientific_name: `${s.canonical_genus} ${s.canonical_species_name}`,
			program_class: s.program_class,
			group_id: s.group_id
		}));
		
		res.json(formattedSpecies);
	} catch (error) {
		console.error("Error in species typeahead search:", error);
		sendApiErrors.searchFailed(res, "species");
	}
};