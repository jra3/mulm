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

/**
 * Set OAuth state for a session
 */
export async function setOAuthState(sessionId: string, state: string): Promise<void> {
  await withTransaction(async (db) => {
    const stmt = await db.prepare('UPDATE sessions SET oauth_state = ? WHERE session_id = ?');
    try {
      await stmt.run(state, sessionId);
    } finally {
      await stmt.finalize();
    }
  });
}

/**
 * Get and clear OAuth state (one-time use)
 */
export async function getAndClearOAuthState(sessionId: string): Promise<string | null> {
  let state: string | null = null;

  await withTransaction(async (db) => {
    // Get state
    const selectStmt = await db.prepare('SELECT oauth_state FROM sessions WHERE session_id = ?');
    try {
      const result = await selectStmt.get<{ oauth_state: string | null }>(sessionId);
      state = result?.oauth_state || null;
    } finally {
      await selectStmt.finalize();
    }

    // Clear state (one-time use)
    if (state) {
      const updateStmt = await db.prepare('UPDATE sessions SET oauth_state = NULL WHERE session_id = ?');
      try {
        await updateStmt.run(sessionId);
      } finally {
        await updateStmt.finalize();
      }
    }
  });

  return state;
}
