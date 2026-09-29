import config from "./config.json";
import { Response } from "express";
import { generateRandomCode } from "./auth";

/**
 * Check if Google OAuth is configured
 */
export function isGoogleOAuthEnabled(): boolean {
  return Boolean(
    config.oauth?.google?.clientId &&
    config.oauth?.google?.clientSecret
  );
}

/**
 * Set OAuth state cookie for CSRF protection
 * Call this before redirecting user to the OAuth provider
 * Returns the generated state token
 */
export function setOAuthStateCookie(res: Response): string {
  const state = generateRandomCode(32);
  res.cookie("oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/oauth",
    maxAge: 10 * 60 * 1000, // 10 minutes
  });
  return state;
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
