import { Request, Response, NextFunction } from "express";
import { writeConn, query } from "./db/conn";
import { generateRandomCode } from "./auth";
import { regenerateSessionInDB } from "./db/sessions";
import { logger } from "./utils/logger";

export const generateSessionCookie = () => generateRandomCode(64);

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

export async function sessionMiddleware(req: MulmRequest, _res: Response, next: NextFunction) {
  const token = String(req.cookies.session_id);
  if (token) {
    req.viewer = await getLoggedInUser(token);
  }
  next();
}

async function getLoggedInUser(token: string) {
  const now = new Date().toISOString();
  return (
    await query<Viewer>(
      `
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
			`,
      [token, now]
    )
  ).pop();
}

/**
 * Regenerate session ID to prevent session fixation attacks
 * Called after authentication events (login, signup, OAuth, password reset)
 *
 * This is critical for security - it ensures an attacker can't pre-set
 * a session cookie and then have it authenticated when the victim logs in.
 */
export async function regenerateSession(
  req: Request,
  res: Response,
  memberId: number
): Promise<void> {
  const oldSessionId = String(req.cookies.session_id);
  const newSessionId = generateSessionCookie();
  const expiry = new Date(Date.now() + 180 * 86400 * 1000).toISOString();

  // Delete old session and create new one atomically
  await regenerateSessionInDB(oldSessionId, newSessionId, memberId, expiry);

  // Set new cookie
  res.cookie("session_id", newSessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 180 * 86400 * 1000,
  });
}

export async function destroyUserSession(req: MulmRequest, res: Response) {
  res.cookie("session_id", null);
  const token = String(req.cookies.session_id);
  if (token !== undefined) {
    try {
      const conn = writeConn;
      const deleteRow = await conn.prepare("DELETE FROM sessions WHERE session_id = ?");
      try {
        await deleteRow.run(token);
      } finally {
        await deleteRow.finalize();
      }
    } catch (err) {
      logger.error("Failed to delete session", err);
      throw new Error("Failed to delete session");
    }
  }
}
