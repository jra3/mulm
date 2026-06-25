import { Request, Response, NextFunction } from "express";
import { writeConn, query } from "./db/conn";
import { generateRandomCode } from "./auth";
import { regenerateSessionInDB } from "./db/sessions";
import { logger } from "./utils/logger";

export const generateSessionCookie = () => generateRandomCode(64);

/**
 * Session lifetime. We deliberately keep the long-lived (180 day) cookie that
 * predates issue #19 — session IDs are rotated on every authentication event
 * (see {@link regenerateSession}) which is the important fixation defense.
 */
export const SESSION_MAX_AGE_MS = 180 * 86400 * 1000;

/**
 * Name of the session cookie.
 *
 * In production we use the `__Host-` prefix. The browser only accepts a
 * `__Host-`-prefixed cookie when it is `Secure`, has **no** `Domain`
 * attribute, and uses `Path=/`. That gives us cheap, browser-enforced defense
 * against subdomain cookie-forgery (a sibling `*.basny.org` can't set our
 * session cookie) and HTTPS-downgrade attacks.
 *
 * The prefix *requires* `Secure`, so we cannot use it in dev/test where the app
 * is served over plain HTTP on localhost — there we fall back to the bare name.
 */
export const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production" ? "__Host-session_id" : "session_id";

/**
 * Cookie options for the session cookie. Centralized so the set/clear sites
 * stay in sync (clearing a cookie requires matching attributes). `path: "/"`
 * and the production-only `secure` flag are also what the `__Host-` prefix
 * requires.
 */
export function sessionCookieOptions(maxAgeMs: number = SESSION_MAX_AGE_MS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeMs,
  };
}

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
  const token = getSessionToken(req);
  if (token) {
    req.viewer = await getLoggedInUser(token);
  }
  next();
}

/** Read the raw session token from the request cookies, or "" if absent. */
function getSessionToken(req: Request): string {
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.[SESSION_COOKIE_NAME] ?? "";
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
  const oldSessionId = getSessionToken(req);
  const newSessionId = generateSessionCookie();
  const expiry = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();

  // Delete old session and create new one atomically
  await regenerateSessionInDB(oldSessionId, newSessionId, memberId, expiry);

  // Set new cookie
  res.cookie(SESSION_COOKIE_NAME, newSessionId, sessionCookieOptions());
}

export async function destroyUserSession(req: MulmRequest, res: Response) {
  const token = getSessionToken(req);
  // Clear with matching attributes (path/secure) so the browser actually drops it.
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  if (token) {
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
