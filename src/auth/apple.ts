import config from "@/config.json";
import { SignJWT, importPKCS8, jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import * as z from "zod";
import { createAppleAccount, createMember, getAppleAccount, getMemberByEmail } from "@/db/members";
import { logger } from "@/utils/logger";

/**
 * Sign in with Apple, plain OAuth web flow (#442).
 *
 * Apple differs from Google in three ways that shape this module:
 * - The callback is a cross-site POST (`response_mode=form_post`, mandatory
 *   when asking for name or email), not a GET. The state cookie must be
 *   `SameSite=None`, and the route bypasses the Origin/CSRF-token middleware;
 *   the `state` check is the CSRF control there.
 * - The client secret is not a static string but an ES256 JWT we sign with the
 *   `.p8` key from the developer portal. It is minted per request.
 * - The user's name arrives once, in the `user` form field on the first
 *   authorization, and never again. Everything else comes from the `id_token`.
 */

export const APPLE_ISSUER = "https://appleid.apple.com";
const AUTHORIZE_URL = `${APPLE_ISSUER}/auth/authorize`;
const TOKEN_URL = `${APPLE_ISSUER}/auth/token`;
const JWKS_URL = new URL(`${APPLE_ISSUER}/auth/keys`);

export interface AppleConfig {
  teamId: string;
  keyId: string;
  servicesId: string;
  privateKey: string;
}

export function getAppleConfig(): AppleConfig | undefined {
  const apple = config.oauth?.apple;
  if (!apple?.teamId || !apple.keyId || !apple.servicesId || !apple.privateKey) {
    return undefined;
  }
  return apple;
}

export function getAppleRedirectUri(): string {
  return `https://${config.server.domain}/oauth/apple`;
}

/** The Sign in with Apple link for a page, or null when Apple isn't configured. */
export function appleOAuthURL(state: string): string | null {
  const cfg = getAppleConfig();
  return cfg ? getAppleOAuthURL(state, cfg) : null;
}

export function getAppleOAuthURL(state: string, cfg: AppleConfig): string {
  const endpoint = new URL(AUTHORIZE_URL);
  endpoint.searchParams.append("client_id", cfg.servicesId);
  endpoint.searchParams.append("redirect_uri", getAppleRedirectUri());
  endpoint.searchParams.append("response_type", "code");
  endpoint.searchParams.append("scope", "name email");
  endpoint.searchParams.append("response_mode", "form_post");
  endpoint.searchParams.append("state", state);
  return String(endpoint);
}

/**
 * The `client_secret` Apple expects: a short-lived ES256 JWT signed with the
 * portal key. Apple caps `exp` at six months; ten minutes is plenty since a
 * fresh one is minted for every code exchange.
 */
export async function buildAppleClientSecret(cfg: AppleConfig, now = new Date()): Promise<string> {
  const key = await importPKCS8(cfg.privateKey, "ES256");
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: cfg.keyId })
    .setIssuer(cfg.teamId)
    .setSubject(cfg.servicesId)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 10 * 60)
    .sign(key);
}

/** What Apple POSTs to the redirect URI on success. */
export const appleCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  id_token: z.string().optional(),
  // JSON, only on the very first authorization: {"name":{"firstName","lastName"},"email"}
  user: z.string().optional(),
});

/** What Apple POSTs when the user cancels or something fails on their side. */
export const appleErrorSchema = z.object({
  error: z.string(),
  state: z.string().optional(),
});

export interface AppleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  /** A Hide My Email relay address (`@privaterelay.appleid.com`). */
  isPrivateEmail: boolean;
}

const tokenResponseSchema = z.object({ id_token: z.string().min(1) });

export async function exchangeAppleCode(
  code: string,
  cfg: AppleConfig,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const body = new URLSearchParams({
    client_id: cfg.servicesId,
    client_secret: await buildAppleClientSecret(cfg),
    code,
    grant_type: "authorization_code",
    redirect_uri: getAppleRedirectUri(),
  });
  const resp = await fetchImpl(TOKEN_URL, { method: "POST", body });
  if (!resp.ok) {
    throw new Error(`Apple token exchange failed: ${resp.status} ${await resp.text()}`);
  }
  const parsed = tokenResponseSchema.safeParse(await resp.json());
  if (!parsed.success) {
    throw new Error("Apple token exchange returned no id_token");
  }
  return parsed.data.id_token;
}

let remoteJwks: JWTVerifyGetKey | undefined;
function appleJwks(): JWTVerifyGetKey {
  remoteJwks ??= createRemoteJWKSet(JWKS_URL);
  return remoteJwks;
}

// Apple sends these as the strings "true"/"false" in some flows and as
// booleans in others.
const appleBool = z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]);

const idTokenClaims = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: appleBool.optional(),
  is_private_email: appleBool.optional(),
});

/**
 * Verify the `id_token` against Apple's published keys and pull out the
 * stable identity. `getKey` is injectable so tests can sign with a local key.
 */
export async function verifyAppleIdToken(
  idToken: string,
  cfg: AppleConfig,
  getKey: JWTVerifyGetKey = appleJwks()
): Promise<AppleIdentity> {
  const { payload } = await jwtVerify(idToken, getKey, {
    issuer: APPLE_ISSUER,
    audience: cfg.servicesId,
  });
  const claims = idTokenClaims.parse(payload);
  return {
    sub: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified ?? false,
    isPrivateEmail: claims.is_private_email ?? claims.email.endsWith("@privaterelay.appleid.com"),
  };
}

const appleUserSchema = z.object({
  name: z
    .object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
    })
    .optional(),
});

/**
 * The display name for a new member. Apple only sends `user` on the first
 * authorization, so when it is missing (or unparseable) the local part of the
 * email stands in; the member can rename themselves on /account.
 */
export function appleUserName(userJson: string | undefined, email: string): string {
  if (userJson) {
    try {
      const parsed = appleUserSchema.safeParse(JSON.parse(userJson));
      if (parsed.success) {
        const full = [parsed.data.name?.firstName, parsed.data.name?.lastName]
          .map((part) => part?.trim() ?? "")
          .filter((part) => part.length > 0)
          .join(" ");
        if (full) {
          return full;
        }
      }
    } catch {
      // Not JSON; fall through to the email fallback.
    }
  }
  return email.split("@")[0] ?? email;
}

/**
 * Find the member an Apple identity belongs to, linking or creating as needed.
 * Same policy as Google: a known `sub` logs in; otherwise a logged-in viewer
 * links; otherwise a member with the same email links; otherwise a new member
 * is created with the link in the same transaction. A Hide My Email relay
 * address never matches an existing member, so it lands on the last branch;
 * admins can merge later.
 *
 * Apple always verifies the addresses it hands out, so `emailVerified` is
 * false only if something upstream is wrong. An unverified address must not
 * be allowed to claim an existing member.
 */
export async function resolveAppleMember(
  identity: AppleIdentity,
  name: string,
  viewerId?: number
): Promise<number> {
  const record = await getAppleAccount(identity.sub);
  if (record) {
    return record.member_id;
  }

  if (viewerId !== undefined) {
    await createAppleAccount(viewerId, identity.sub, identity.email);
    return viewerId;
  }

  const member = await getMemberByEmail(identity.email);
  if (member) {
    if (!identity.emailVerified) {
      throw new Error("Apple did not verify the email address; refusing to link an existing member");
    }
    await createAppleAccount(member.id, identity.sub, identity.email);
    return member.id;
  }

  if (identity.isPrivateEmail) {
    logger.info("New member via an Apple relay address; may need merging with an existing account", {
      email: identity.email,
    });
  }
  return createMember(identity.email, name, { apple_sub: identity.sub });
}
