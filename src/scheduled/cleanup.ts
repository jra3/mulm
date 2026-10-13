import { deleteExpiredAuthCodes } from "@/db/auth";
import { ensureReady } from "@/db/conn";
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
    await ensureReady();

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

let cleanupRunning: Promise<unknown> | undefined;
let cleanupTimeout: NodeJS.Timeout | null = null;
let cleanupInterval: NodeJS.Timeout | null = null;

/** Keep a startup catch-up run owned until it finishes, even across the daily slot. */
function launchScheduledRun(): void {
  cleanupRunning ??= runDailyCleanup().finally(() => {
    cleanupRunning = undefined;
  });
}

/**
 * Start the scheduled cleanup task
 * Runs daily at 3:00 AM server time
 */
export function startScheduledCleanup(): void {
  if (cleanupTimeout || cleanupInterval) return;
  // Run cleanup immediately on startup (to catch any missed cleanups)
  launchScheduledRun();

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
  cleanupTimeout = setTimeout(() => {
    launchScheduledRun();

    // Then run every 24 hours
    cleanupInterval = setInterval(
      () => {
        launchScheduledRun();
      },
      24 * 60 * 60 * 1000
    ); // 24 hours
  }, msUntilNext3AM);
}

/**
 * Stop the scheduled cleanup task
 * Useful for graceful shutdown or testing
 */
export async function stopScheduledCleanup(): Promise<void> {
  if (cleanupTimeout) {
    clearTimeout(cleanupTimeout);
    cleanupTimeout = null;
  }
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info("Scheduled cleanup stopped");
  }
  await cleanupRunning;
}
