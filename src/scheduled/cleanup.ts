import { deleteExpiredAuthCodes } from "@/db/auth";
import { deleteExpiredChallenges } from "@/db/webauthn";
import { db } from "@/db/conn";
import { logger } from "@/utils/logger";

/**
 * Run daily cleanup tasks for expired data
 * - Deletes expired password reset tokens (auth_codes)
 * - Deletes expired WebAuthn challenges
 */
export async function runDailyCleanup(): Promise<void> {
  try {
    // Check if database is initialized before running cleanup
    if (!db(true)) {
      logger.warn("Database not yet initialized, skipping cleanup");
      return;
    }

    logger.info("Starting daily cleanup tasks");

    // Delete expired auth codes (password reset tokens)
    const authCodesResult = await deleteExpiredAuthCodes(new Date());
    const authCodesDeleted = authCodesResult.changes || 0;
    logger.info(`Deleted ${authCodesDeleted} expired auth codes`);

    // Delete expired WebAuthn challenges
    const challengesDeleted = await deleteExpiredChallenges();
    logger.info(`Deleted ${challengesDeleted} expired WebAuthn challenges`);

    logger.info("Daily cleanup tasks completed successfully");
  } catch (err) {
    logger.error("Error during daily cleanup", err);
  }
}

let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start the scheduled cleanup task
 * Runs daily at 3:00 AM server time
 */
export function startScheduledCleanup(): void {
  // Run cleanup immediately on startup (to catch any missed cleanups)
  void runDailyCleanup();

  // Calculate milliseconds until next 3 AM
  const now = new Date();
  const next3AM = new Date();
  next3AM.setHours(3, 0, 0, 0);

  // If we've passed 3 AM today, schedule for tomorrow
  if (now.getHours() >= 3) {
    next3AM.setDate(next3AM.getDate() + 1);
  }

  const msUntilNext3AM = next3AM.getTime() - now.getTime();

  logger.info(`Next cleanup scheduled for ${next3AM.toISOString()}`);

  // Schedule first cleanup at 3 AM
  setTimeout(() => {
    void runDailyCleanup();

    // Then run every 24 hours
    cleanupInterval = setInterval(() => {
      void runDailyCleanup();
    }, 24 * 60 * 60 * 1000); // 24 hours
  }, msUntilNext3AM);
}

/**
 * Stop the scheduled cleanup task
 * Useful for graceful shutdown or testing
 */
export function stopScheduledCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info("Scheduled cleanup stopped");
  }
}
