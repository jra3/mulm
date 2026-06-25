import { withTransaction } from "./conn";

/**
 * Regenerate session (delete old, create new) - for session fixation protection
 */
export async function regenerateSessionInDB(
  oldSessionId: string | undefined,
  newSessionId: string,
  memberId: number,
  expiresOn: string,
  csrfToken: string
): Promise<void> {
  await withTransaction(async (db) => {
    // Delete old session if it exists
    if (oldSessionId && oldSessionId !== "undefined") {
      const deleteStmt = await db.prepare("DELETE FROM sessions WHERE session_id = ?");
      try {
        await deleteStmt.run(oldSessionId);
      } finally {
        await deleteStmt.finalize();
      }
    }

    // Create new session
    const insertStmt = await db.prepare(`
      INSERT INTO sessions (session_id, member_id, expires_on, csrf_token)
      VALUES (?, ?, ?, ?);
    `);
    try {
      await insertStmt.run(newSessionId, memberId, expiresOn, csrfToken);
    } finally {
      await insertStmt.finalize();
    }
  });
}

// OAuth state functions removed - now using cookie-based approach
// See src/oauth.ts: setOAuthStateCookie() and OAuth callback validation
