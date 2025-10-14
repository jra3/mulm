import { query, withTransaction } from "../db/conn";
import { logger } from "../utils/logger";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Record a failed login attempt and lock account if threshold exceeded
 * @returns true if account is now locked, false otherwise
 */
export async function recordFailedAttempt(memberId: number, ipAddress: string): Promise<boolean> {
  return await withTransaction(async (db) => {
    // Record the failed attempt
    const insertStmt = await db.prepare(`
      INSERT INTO failed_login_attempts (member_id, attempted_at, ip_address)
      VALUES (?, ?, ?)
    `);
    try {
      await insertStmt.run(memberId, new Date().toISOString(), ipAddress);
    } finally {
      await insertStmt.finalize();
    }

    // Count recent attempts within the window
    const windowStart = new Date(Date.now() - ATTEMPT_WINDOW_MS).toISOString();
    const countStmt = await db.prepare(`
      SELECT COUNT(*) as count
      FROM failed_login_attempts
      WHERE member_id = ? AND attempted_at > ?
    `);
    let attemptCount = 0;
    try {
      const result = await countStmt.get<{ count: number }>(memberId, windowStart);
      attemptCount = result?.count || 0;
    } finally {
      await countStmt.finalize();
    }

    // Lock account if threshold exceeded
    if (attemptCount >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
      const updateStmt = await db.prepare("UPDATE members SET locked_until = ? WHERE id = ?");
      try {
        await updateStmt.run(lockedUntil, memberId);
        logger.warn("Account locked due to failed login attempts", {
          memberId,
          attemptCount,
          lockedUntil,
        });
      } finally {
        await updateStmt.finalize();
      }
      return true;
    }

    return false;
  });
}

/**
 * Check if an account is currently locked
 */
export async function isAccountLocked(memberId: number): Promise<boolean> {
  const [member] = await query<{ locked_until: string | null }>(
    "SELECT locked_until FROM members WHERE id = ?",
    [memberId]
  );

  if (!member?.locked_until) {
    return false;
  }

  const lockedUntil = new Date(member.locked_until);
  const now = new Date();

  // If lock has expired, clear it
  if (lockedUntil <= now) {
    await clearLockout(memberId);
    return false;
  }

  return true;
}

/**
 * Clear all failed login attempts and lockout for an account
 * Called on successful login or admin unlock
 */
export async function clearFailedAttempts(memberId: number): Promise<void> {
  await withTransaction(async (db) => {
    // Delete failed attempts
    const deleteStmt = await db.prepare("DELETE FROM failed_login_attempts WHERE member_id = ?");
    try {
      await deleteStmt.run(memberId);
    } finally {
      await deleteStmt.finalize();
    }

    // Clear lockout
    const updateStmt = await db.prepare("UPDATE members SET locked_until = NULL WHERE id = ?");
    try {
      await updateStmt.run(memberId);
    } finally {
      await updateStmt.finalize();
    }
  });

  logger.info("Cleared failed login attempts", { memberId });
}

/**
 * Clear lockout but keep failed attempt history
 * Used when lockout expires naturally
 */
async function clearLockout(memberId: number): Promise<void> {
  await withTransaction(async (db) => {
    const stmt = await db.prepare("UPDATE members SET locked_until = NULL WHERE id = ?");
    try {
      await stmt.run(memberId);
    } finally {
      await stmt.finalize();
    }
  });
}

/**
 * Get remaining lockout time in seconds
 * Returns 0 if not locked
 */
export async function getRemainingLockoutTime(memberId: number): Promise<number> {
  const [member] = await query<{ locked_until: string | null }>(
    "SELECT locked_until FROM members WHERE id = ?",
    [memberId]
  );

  if (!member?.locked_until) {
    return 0;
  }

  const lockedUntil = new Date(member.locked_until);
  const now = new Date();
  const remainingMs = lockedUntil.getTime() - now.getTime();

  return Math.max(0, Math.ceil(remainingMs / 1000));
}
