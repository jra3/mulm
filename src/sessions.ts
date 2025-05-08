import { Request, Response, NextFunction } from "express";
import { writeConn, query } from "./db/conn";
import { generateRandomCode } from "./auth";

export const generateSessionCookie = () => generateRandomCode(64)

type Viewer = {
	id: number;
	display_name: string;
	contact_email: string;
	//image: string | null | undefined;
	is_admin?: boolean;
	fish_level?: string;
	plant_level?: string;
	coral_level?: string;
};

export type MulmRequest = Request & { viewer?: Viewer };

export async function sessionMiddleware(
	req: MulmRequest,
	_res: Response,
	next: NextFunction) {

	const token = req.cookies.session_id;
	if (token) {
		req.viewer = await getLoggedInUser(token);
	}
	next();
}

async function getLoggedInUser(token: string) {
			const now = new Date().toISOString();
			return (await query<Viewer>(`
				SELECT
					members.id as id,
					members.display_name as display_name,
					members.contact_email as contact_email,
					members.is_admin as is_admin,
					members.fish_level as fish_level,
					members.plant_level as plant_level,
					members.coral_level as coral_level
				FROM sessions JOIN members ON sessions.member_id = members.id
				WHERE session_id = ? AND expires_on > ?;
			`, [token, now])).pop();
		}

export async function createUserSession(req: Request, res: Response, memberId: number) {
	const cookieValue = generateSessionCookie();
	try {
		const conn = writeConn;
		const expiry = new Date(Date.now() + (180 * 86400 * 1000));
		const insertStmt = await conn.prepare(`
			INSERT INTO sessions (session_id, member_id, expires_on) VALUES (?, ?, ?);
		`);
		await insertStmt.run(cookieValue, memberId, expiry.toISOString());
	} catch (err) {
		console.error(err);
		throw new Error("Failed to get member");
	}

	res.cookie('session_id', cookieValue, {
		httpOnly: true,
		maxAge: 180 * 86400 * 1000, // 180 days
	});
}

export async function destroyUserSession(req: MulmRequest, res: Response) {
	res.cookie('session_id', null);
	const token = req.cookies.session_id;
	if (token !== undefined) {
		try {
			const conn = writeConn;
			const deleteRow = await conn.prepare('DELETE FROM sessions WHERE session_id = ?');
			await deleteRow.run(token);
		} catch (err) {
			console.error(err);
			throw new Error("Failed to delete session");
		}
	}
}
