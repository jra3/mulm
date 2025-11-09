import { deleteExpiredAuthCodes } from "@/db/auth";
import { deleteExpiredChallenges } from "@/db/webauthn";
import { db, query } from "@/db/conn";
import { logger } from "@/utils/logger";
import { listAllObjects, deleteImage, isR2Enabled, type ImageMetadata } from "@/utils/r2-client";

/**
 * Cleanup orphaned images from R2 that are not referenced in the database
 * Only deletes images older than 7 days as a safety measure
 */
async function cleanupOrphanedImages(): Promise<{ deleted: number; skipped: number }> {
  if (!isR2Enabled()) {
    logger.info("R2 not enabled, skipping orphaned image cleanup");
    return { deleted: 0, skipped: 0 };
  }

  logger.info("Starting orphaned image cleanup");

  try {
    // Step 1: Get all referenced image keys from database
    const referencedKeys = new Set<string>();

    // Query submission_images table (normalized)
    const submissionImages = await query<{ r2_key: string }>(
      "SELECT r2_key FROM submission_images"
    );

    for (const row of submissionImages) {
      // Add original key
      referencedKeys.add(row.r2_key);

      // Add derived variants (medium and thumb)
      const mediumKey = row.r2_key.replace("-original.", "-medium.");
      const thumbKey = row.r2_key.replace("-original.", "-thumb.");
      referencedKeys.add(mediumKey);
      referencedKeys.add(thumbKey);
    }

    // Query collection entries
    const collections = await query<{ images: string | null }>(
      "SELECT images FROM species_collection WHERE images IS NOT NULL"
    );

    for (const row of collections) {
      if (row.images) {
        try {
          const imageArray = JSON.parse(row.images) as ImageMetadata[];
          for (const img of imageArray) {
            // Add original key
            referencedKeys.add(img.key);

            // Add derived variants
            const mediumKey = img.key.replace("-original.", "-medium.");
            const thumbKey = img.key.replace("-original.", "-thumb.");
            referencedKeys.add(mediumKey);
            referencedKeys.add(thumbKey);
          }
        } catch (parseErr) {
          logger.warn(`Failed to parse images JSON for collection entry`, { error: parseErr });
        }
      }
    }

    logger.info(`Found ${referencedKeys.size} referenced image keys in database`);

    // Step 2: List all objects in R2 with "submissions/" prefix
    const r2Objects = await listAllObjects("submissions/");
    logger.info(`Found ${r2Objects.length} objects in R2`);

    // Step 3: Identify orphans (objects not in referenced set and older than 7 days)
    const orphans: Array<{ key: string; age: number }> = [];
    const SAFETY_AGE_DAYS = 7;

    for (const obj of r2Objects) {
      if (!referencedKeys.has(obj.key)) {
        // Object is not referenced in database
        const ageMs = Date.now() - obj.lastModified.getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);

        if (ageDays > SAFETY_AGE_DAYS) {
          orphans.push({ key: obj.key, age: ageDays });
        }
      }
    }

    logger.info(`Identified ${orphans.length} orphaned images older than ${SAFETY_AGE_DAYS} days`);

    // Step 4: Delete orphans with error handling
    let deleted = 0;
    let skipped = 0;

    for (const orphan of orphans) {
      try {
        await deleteImage(orphan.key);
        deleted++;
        logger.info(`Deleted orphaned image: ${orphan.key} (age: ${orphan.age.toFixed(1)} days)`);
      } catch (deleteErr) {
        skipped++;
        logger.error(`Failed to delete orphaned image: ${orphan.key}`, deleteErr);
      }
    }

    logger.info(`Orphaned image cleanup complete: deleted=${deleted}, skipped=${skipped}`);

    return { deleted, skipped };
  } catch (err) {
    logger.error("Error during orphaned image cleanup", err);
    return { deleted: 0, skipped: 0 };
  }
}

/**
 * Run daily cleanup tasks for expired data
 * - Deletes expired password reset tokens (auth_codes)
 * - Deletes expired WebAuthn challenges
 * - Deletes orphaned images from R2 (older than 7 days)
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

    // Delete orphaned images from R2
    const imageCleanup = await cleanupOrphanedImages();
    logger.info(
      `Orphaned image cleanup: ${imageCleanup.deleted} deleted, ${imageCleanup.skipped} skipped`
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
