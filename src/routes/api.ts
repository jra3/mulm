import { Response } from 'express';
import { MulmRequest } from '@/sessions';
import { searchMembers as searchMembersDb } from '@/db/members';
import { getQueryString } from '@/utils/request';
import { MemberTypeaheadItem, ApiErrorResponse } from '@/types/api-responses';

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
        const errorResponse: ApiErrorResponse = {
            error: "Unable to search members",
            code: "MEMBER_SEARCH_ERROR"
        };
        res.status(500).json(errorResponse);
    }
};