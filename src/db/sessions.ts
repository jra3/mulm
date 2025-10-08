import { withTransaction } from "./conn";

/**
 * Delete a session by session ID
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await withTransaction(async (db) => {
    const stmt = await db.prepare('DELETE FROM sessions WHERE session_id = ?');
    try {
      await stmt.run(sessionId);
    } finally {
      await stmt.finalize();
    }
  });
}

/**
 * Create a new session
 */
export async function createSession(sessionId: string, memberId: number, expiresOn: string): Promise<void> {
  await withTransaction(async (db) => {
    const stmt = await db.prepare(`
      INSERT INTO sessions (session_id, member_id, expires_on)
      VALUES (?, ?, ?);
    `);
    try {
      await stmt.run(sessionId, memberId, expiresOn);
    } finally {
      await stmt.finalize();
    }
  });
}

/**
 * Regenerate session (delete old, create new) - for session fixation protection
 */
export async function regenerateSessionInDB(oldSessionId: string | undefined, newSessionId: string, memberId: number, expiresOn: string): Promise<void> {
  await withTransaction(async (db) => {
    // Delete old session if it exists
    if (oldSessionId && oldSessionId !== 'undefined') {
      const deleteStmt = await db.prepare('DELETE FROM sessions WHERE session_id = ?');
      try {
        await deleteStmt.run(oldSessionId);
      } finally {
        await deleteStmt.finalize();
      }
    }

    // Create new session
    const insertStmt = await db.prepare(`
      INSERT INTO sessions (session_id, member_id, expires_on)
      VALUES (?, ?, ?);
    `);
    try {
      await insertStmt.run(newSessionId, memberId, expiresOn);
    } finally {
      await insertStmt.finalize();
    }
  });
}

// OAuth state functions removed - now using cookie-based approach
// See src/oauth.ts: setOAuthStateCookie() and OAuth callback validation
