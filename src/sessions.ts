import crypto from 'crypto'
import { getWriteDBConnecton, query } from "./db/conn";
import { Context, Next, ParameterizedContext } from "koa";

export function generateSessionCookie(length = 64) {
	const bytes = crypto.randomBytes(length);
	return bytes.toString('base64url');
}

export type MulmContext = Context &{
	loggedInUser?: {
		member_id: number,
		member_name: string,
		member_email: string,
		is_admin: boolean,
	},
}

export async function sessionMiddleware(ctx: MulmContext, next: Next) {
	const token = ctx.cookies.get('session_id');
	if (token) {
		ctx.loggedInUser = getLoggedInUser(token);
	}
	await next();
}

function getLoggedInUser(token: string) {
	const now = new Date().toISOString();
	return query<{
		member_id: number,
		member_name: string,
		member_email: string,
		is_admin: boolean,
	}>(`
		SELECT members.id as member_id, members.display_name as member_name, members.contact_email as member_email, members.is_admin as is_admin
		FROM sessions JOIN members ON sessions.member_id = members.id
		WHERE session_id = ? AND expires_on > ?;
	`, [token, now]).pop();
}

export function createUserSession(ctx: ParameterizedContext, memberId: number) {
	const cookieValue = generateSessionCookie();
	try {
		const conn = getWriteDBConnecton()

		const expiry = new Date(Date.now() + (180 * 86400 * 1000));
		const insertStmt = conn.prepare(`
			INSERT INTO sessions (session_id, member_id, expires_on) VALUES (?, ?, ?);
		`);
		insertStmt.run(cookieValue, memberId, expiry.toISOString());
	} catch (err) {
		console.error(err);
		throw new Error("Failed to get member");
	}

	ctx.cookies.set('session_id', cookieValue, {
		httpOnly: true,
		maxAge: 180 * 86400 * 1000, // 180 days
	});
}

export function destroyUserSession(ctx: ParameterizedContext) {
	const cookie = ctx.cookies.get("session_id");
	if (cookie !== undefined) {
		try {
			const conn = getWriteDBConnecton()
			const deleteRow = conn.prepare('DELETE FROM sessions WHERE session_id = ?');
			deleteRow.run(cookie);
		} catch (err) {
			console.error(err);
			throw new Error("Failed to delete submission");
		}
		ctx.cookies.set('session_id', null);
	}
}
