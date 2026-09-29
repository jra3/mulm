import config from "./config.json";
import { Response } from "express";
import { MulmRequest } from "./sessions";
import { logger } from "./utils/logger";
import { generateRandomCode } from "./auth";
import { createAuthCode, deleteAuthCode, getAuthCode } from "./db/auth";

/**
 * Check if Google OAuth is configured
 */
export function isGoogleOAuthEnabled(): boolean {
  return Boolean(
    config.oauth?.google?.clientId &&
    config.oauth?.google?.clientSecret
  );
}

export const OAUTH_STATE_COOKIE = "oauth_state";
export const OAUTH_STATE_COOKIE_PATH = "/oauth";

/**
 * Set the OAuth state cookie for CSRF protection before redirecting to a
 * provider, and return the state to put in the redirect.
 *
 * `SameSite=None`, not Lax: Apple returns with a cross-site POST
 * (`response_mode=form_post`), and browsers drop Lax cookies on those. It is
 * safe for every provider because the cookie is httpOnly, ten minutes, scoped
 * to /oauth and holds only this random token; an attacker can't read it, so
 * can't forge a callback whose `state` matches. `Secure` is mandatory with
 * None; Chrome and Firefox still accept it on http://localhost.
 */
export function setOAuthStateCookie(res: Response): string {
  const state = generateRandomCode(32);
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: OAUTH_STATE_COOKIE_PATH,
    maxAge: 10 * 60 * 1000, // 10 minutes
  });
  return state;
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Start a provider flow. When a signed-in member starts it (linking from
 * /account), the member is bound to the state server-side, because the
 * session cookie is SameSite=Lax and will not accompany Apple's cross-site
 * callback; `req.viewer` is empty there. The binding, not the session, says
 * whom to link.
 */
export async function beginOAuthFlow(res: Response, linkMemberId?: number): Promise<string> {
  const state = setOAuthStateCookie(res);
  if (linkMemberId !== undefined) {
    await createAuthCode({
      code: state,
      member_id: linkMemberId,
      purpose: "oauth_link",
      expires_on: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    });
  }
  return state;
}

/**
 * The member bound to this state by {@link beginOAuthFlow}, if any. One-shot:
 * the binding is deleted whether or not it is still valid.
 */
export async function takeOAuthLinkMember(state: string): Promise<number | undefined> {
  const code = await getAuthCode(state);
  if (!code || code.purpose !== "oauth_link") {
    return undefined;
  }
  await deleteAuthCode(state);
  return new Date(code.expires_on) > new Date() ? code.member_id : undefined;
}

export function clearOAuthStateCookie(res: Response): void {
  res.clearCookie(OAUTH_STATE_COOKIE, { path: OAUTH_STATE_COOKIE_PATH });
}

/**
 * The CSRF check on a provider callback: the `state` the provider echoed back
 * must equal the one in the cookie set before the redirect. The cookie is
 * consumed either way. On a mismatch the response is already sent (403) and
 * the caller must stop.
 */
export function consumeOAuthState(req: MulmRequest, res: Response, state: string): boolean {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const stored = cookies?.[OAUTH_STATE_COOKIE];
  clearOAuthStateCookie(res);
  if (typeof stored !== "string" || stored.length === 0 || stored !== state) {
    logger.warn("Invalid OAuth state parameter", {
      storedState: typeof stored === "string" ? stored.substring(0, 10) + "..." : null,
      receivedState: state.substring(0, 10) + "...",
    });
    res
      .status(403)
      .send("Invalid OAuth state. This may be a CSRF attack. Please try logging in again.");
    return false;
  }
  return true;
}

export function getGoogleOAuthURL(state: string): string {
  const endpoint = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  endpoint.searchParams.append("access_type", "offline");
  endpoint.searchParams.append("client_id", config.oauth.google.clientId);
  endpoint.searchParams.append("redirect_uri", `https://${config.server.domain}/oauth/google`);
  endpoint.searchParams.append("scope", "email profile");
  endpoint.searchParams.append("response_type", "code");
  endpoint.searchParams.append("state", state); // CSRF protection
  return String(endpoint);
}

/**
 * https://developers.google.com/youtube/reporting/guides/authorization/server-side-web-apps#exchange-authorization-code
 */
export async function translateGoogleOAuthCode(code: string) {
  const endpoint = new URL("https://oauth2.googleapis.com/token");
  const body = new URLSearchParams({
    client_id: config.oauth.google.clientId,
    client_secret: config.oauth.google.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: `https://${config.server.domain}/oauth/google`,
    code,
  });
  return fetch(endpoint, { body, method: "POST" });
}

export async function getGoogleUser(
  accessToken: string
): Promise<{ sub: string; name: string; email: string }> {
  const resp = await fetch(
    `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${accessToken}`
  );
  if (!resp.ok) {
    throw new Error("Failed to fetch user from Google");
  }
  const respBody: unknown = await resp.json();

  if (
    typeof respBody !== "object" ||
    respBody === null ||
    !("name" in respBody) ||
    !("email" in respBody) ||
    !("sub" in respBody)
  ) {
    throw new Error("Failed to fetch user from Google");
  }

  const googleUser = respBody as { sub: string; name: string; email: string };

  if (googleUser.name == null || googleUser.email == null) {
    throw new Error("Failed to fetch user from Google");
  }

  return {
    sub: String(googleUser.sub),
    name: String(googleUser.name),
    email: String(googleUser.email),
  };
}
