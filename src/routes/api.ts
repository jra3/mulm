import { Response } from 'express';
import { MulmRequest } from '@/sessions';
import { getRoster } from '@/db/members';
import { getQueryString } from '@/utils/request';

export const searchMembers = async (req: MulmRequest, res: Response) => {
    const query = getQueryString(req, 'q', '').toLowerCase().trim();
    if (query.length < 2) {
        res.json([]);
        return;
    }
    
    const members = await getRoster();
    
    const filteredMembers = members
        .filter(member => 
            (member.display_name || "").toLowerCase().includes(query) ||
            (member.contact_email || "").toLowerCase().includes(query))
        .slice(0, 10) // Limit to 10 results
        .map(member => ({
            value: member.display_name,
            text: member.display_name,
            email: member.contact_email,
            name: member.display_name
        }));
    
    res.json(filteredMembers);
};