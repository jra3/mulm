import { deleteExpiredAuthCodes } from "@/db/auth";
import { ready } from "@/db/conn";
import { logger } from "@/utils/logger";
import { sweepMemberLevels } from "./level-sweep";

/**
 * Run daily cleanup tasks for expired data
 * - Deletes expired password reset tokens (auth_codes)
 * - Sweeps member levels back into sync
 *
 * Nothing here deletes images from R2. An unreferenced image costs next to
 * nothing to keep, and a sweep that guesses wrong deletes one for good.
 */
export async function runDailyCleanup(): Promise<void> {
  try {
    // Wait for database to be initialized and migrations to complete
    await ready;

    logger.info("Starting daily cleanup tasks");

    // Delete expired auth codes (password reset tokens)
    const authCodesResult = await deleteExpiredAuthCodes(new Date());
    const authCodesDeleted = authCodesResult.changes || 0;
    logger.info(`Deleted ${authCodesDeleted} expired auth codes`);

    // Sweep member levels to catch any that are out of sync
    const levelSweep = await sweepMemberLevels();
    logger.info(
      `Level sweep: ${levelSweep.checked} checked, ${levelSweep.updated} updated, ${levelSweep.errors} errors`
    );

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
