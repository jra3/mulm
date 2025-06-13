import { Response } from 'express';
import { MulmRequest } from '@/sessions';
import { getRoster } from '@/db/members';
import { getQueryString } from '@/utils/request';
import { MemberTypeaheadItem, ApiErrorResponse } from '@/types/api-responses';

export const searchMembers = async (req: MulmRequest, res: Response<MemberTypeaheadItem[] | ApiErrorResponse>) => {
    try {
        const query = getQueryString(req, 'q', '').toLowerCase().trim();
        if (query.length < 2) {
            res.json([]);
            return;
        }
        
        const members = await getRoster();
        
        const filteredMembers: MemberTypeaheadItem[] = members
            .filter(member => 
                (member.display_name || "").toLowerCase().includes(query) ||
                (member.contact_email || "").toLowerCase().includes(query))
            .slice(0, 10) // Limit to 10 results
            .map(member => ({
                value: member.display_name,  // Using display name as value to match form field
                text: member.display_name,
                email: member.contact_email
            }));
        
        res.json(filteredMembers);
    } catch (error) {
        console.error("Error in member search API:", error);
        const errorResponse: ApiErrorResponse = {
            error: "Unable to search members",
            code: "MEMBER_SEARCH_ERROR"
        };
        res.status(500).json(errorResponse);
    }
};