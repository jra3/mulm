/**
 * Admin API tokens (#595): the bearer credentials for /api/admin.
 *
 * A token is `basny_` followed by 32 random bytes in base64url. It is shown
 * once, at mint; the table keeps only its SHA-256. A token acts as the admin
 * it was minted for, with no scopes, and only while that member is still an
 * admin, which {@link verifyAdminToken} checks on every use. Tokens are
 * revoked, never deleted.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Database } from "sqlite";
import { query, writeConn } from "./conn";

export const ADMIN_TOKEN_PREFIX = "basny_";
const TOKEN_PATTERN = /^basny_[A-Za-z0-9_-]{43}$/;

export type AdminToken = {
  id: number;
  member_id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

export type AdminTokenListing = AdminToken & {
  display_name: string;
  contact_email: string;
};

/** The admin a verified token acts as, and the token itself. */
export type AdminApiActor = {
  member: { id: number; display_name: string };
  token: AdminToken;
};

export class AdminTokenError extends Error {}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mint a token for an admin. Returns the raw token, which nothing else will
 * ever see again, alongside the stored row.
 */
export async function createAdminToken(
  memberId: number,
  name: string,
  options: { expiresInDays?: number; now?: Date } = {}
): Promise<{ token: string; record: AdminToken }> {
  const label = name.trim();
  if (!label) throw new AdminTokenError("A token needs a name");
  const member = (
    await query<{ is_admin: number | null }>("SELECT is_admin FROM members WHERE id = ?", [
      memberId,
    ])
  ).pop();
  if (!member) throw new AdminTokenError(`No member with id ${memberId}`);
  if (!member.is_admin) throw new AdminTokenError(`Member ${memberId} is not an admin`);

  const now = options.now ?? new Date();
  const { expiresInDays } = options;
  if (expiresInDays !== undefined && !(Number.isInteger(expiresInDays) && expiresInDays > 0)) {
    throw new AdminTokenError("Expiry must be a whole number of days greater than zero");
  }
  const expiresAt =
    expiresInDays === undefined
      ? null
      : new Date(now.getTime() + expiresInDays * 86_400_000).toISOString();

  const token = ADMIN_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const result = await writeConn.run(
    `INSERT INTO admin_api_tokens (member_id, name, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [memberId, label, hashToken(token), now.toISOString(), expiresAt]
  );
  return {
    token,
    record: {
      id: result.lastID!,
      member_id: memberId,
      name: label,
      created_at: now.toISOString(),
      last_used_at: null,
      expires_at: expiresAt,
      revoked_at: null,
    },
  };
}

export type VerifyResult =
  { ok: true; actor: AdminApiActor } | { ok: false; reason: "invalid" | "not_admin" };

/**
 * Check a presented token. An unknown, malformed, revoked or expired token is
 * `invalid`; a live token whose member is no longer an admin is `not_admin`.
 * A token that passes has its last use recorded.
 */
export async function verifyAdminToken(token: string, now = new Date()): Promise<VerifyResult> {
  if (!TOKEN_PATTERN.test(token)) return { ok: false, reason: "invalid" };
  const hash = hashToken(token);
  const row = (
    await query<AdminToken & { token_hash: string; display_name: string; is_admin: number | null }>(
      `SELECT t.id, t.member_id, t.name, t.token_hash, t.created_at, t.last_used_at,
              t.expires_at, t.revoked_at, m.display_name, m.is_admin
       FROM admin_api_tokens t JOIN members m ON m.id = t.member_id
       WHERE t.token_hash = ?`,
      [hash]
    )
  ).pop();
  // The lookup is by hash, so timing reveals nothing about the token itself.
  // This constant-time compare is belt and braces, not the protection.
  if (!row || !timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(hash))) {
    return { ok: false, reason: "invalid" };
  }
  const nowIso = now.toISOString();
  if (row.revoked_at || (row.expires_at && row.expires_at <= nowIso)) {
    return { ok: false, reason: "invalid" };
  }
  if (!row.is_admin) return { ok: false, reason: "not_admin" };

  await writeConn.run("UPDATE admin_api_tokens SET last_used_at = ? WHERE id = ?", [
    nowIso,
    row.id,
  ]);
  return {
    ok: true,
    actor: {
      member: { id: row.member_id, display_name: row.display_name },
      token: {
        id: row.id,
        member_id: row.member_id,
        name: row.name,
        created_at: row.created_at,
        last_used_at: nowIso,
        expires_at: row.expires_at,
        revoked_at: row.revoked_at,
      },
    },
  };
}

/** Every token, newest first, with its owner. Hashes stay in the table. */
export async function listAdminTokens(): Promise<AdminTokenListing[]> {
  return query<AdminTokenListing>(
    `SELECT t.id, t.member_id, t.name, t.created_at, t.last_used_at, t.expires_at,
            t.revoked_at, m.display_name, m.contact_email
     FROM admin_api_tokens t JOIN members m ON m.id = t.member_id
     ORDER BY t.id DESC`
  );
}

/**
 * Revoke every live token a member holds, inside the transaction that deletes
 * or merges the member away. Foreign keys are not enforced in production, so
 * the table's ON DELETE CASCADE cannot be relied on to remove them; revoking
 * also keeps the row as a record of who held it. Returns how many it revoked.
 */
export async function revokeMemberAdminTokens(
  conn: Database,
  memberId: number,
  now = new Date()
): Promise<number> {
  const result = await conn.run(
    "UPDATE admin_api_tokens SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL",
    [now.toISOString(), memberId]
  );
  return result.changes ?? 0;
}

/** Revoke a token. Returns false if there is no such token or it was already revoked. */
export async function revokeAdminToken(id: number, now = new Date()): Promise<boolean> {
  const result = await writeConn.run(
    "UPDATE admin_api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    [now.toISOString(), id]
  );
  return (result.changes ?? 0) > 0;
}
