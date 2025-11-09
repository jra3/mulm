/**
 * Migration script to move JSON data from TEXT columns to normalized relational tables
 *
 * This script:
 * 1. Reads existing JSON data from TEXT columns
 * 2. Parses and validates the JSON
 * 3. Inserts data into new normalized tables
 * 4. Reports on migration success/failures
 *
 * Run with: npm run script scripts/migrate-json-to-relational.ts
 */

import { query, writeConn } from "@/db/conn";
import { logger } from "@/utils/logger";

interface ImageMetadata {
  key: string;
  url: string;
  size: number;
  uploadedAt: string;
  contentType?: string;
}

interface MigrationStats {
  submissions_processed: number;
  images_migrated: number;
  supplements_migrated: number;
  species_processed: number;
  references_migrated: number;
  species_images_migrated: number;
  errors: string[];
}

const stats: MigrationStats = {
  submissions_processed: 0,
  images_migrated: 0,
  supplements_migrated: 0,
  species_processed: 0,
  references_migrated: 0,
  species_images_migrated: 0,
  errors: [],
};

/**
 * Parse JSON safely with error handling
 */
function parseJsonSafely<T>(jsonString: string | null, defaultValue: T): T {
  if (!jsonString) return defaultValue;
  try {
    return JSON.parse(jsonString) as T;
  } catch (err) {
    return defaultValue;
  }
}

/**
 * Migrate submission images from JSON to submission_images table
 */
async function migrateSubmissionImages(): Promise<void> {
  logger.info("Starting migration of submission images...");

  const submissions = await query<{
    id: number;
    images: string | null;
  }>("SELECT id, images FROM submissions WHERE images IS NOT NULL");

  for (const submission of submissions) {
    try {
      const images = parseJsonSafely<ImageMetadata[]>(submission.images, []);

      if (images.length === 0) {
        continue;
      }

      stats.submissions_processed++;

      // Insert images with display order
      const insertStmt = await writeConn.prepare(`
        INSERT INTO submission_images
        (submission_id, r2_key, public_url, file_size, uploaded_at, content_type, display_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        await insertStmt.run(
          submission.id,
          img.key,
          img.url,
          img.size,
          img.uploadedAt,
          img.contentType || "image/jpeg",
          i
        );
        stats.images_migrated++;
      }

      await insertStmt.finalize();

      logger.info(
        `Migrated ${images.length} images for submission ${submission.id}`
      );
    } catch (err) {
      const error = `Failed to migrate images for submission ${submission.id}: ${err}`;
      logger.error(error);
      stats.errors.push(error);
    }
  }

  logger.info(
    `Completed migration of ${stats.images_migrated} images from ${stats.submissions_processed} submissions`
  );
}

/**
 * Migrate submission supplements from parallel JSON arrays to submission_supplements table
 */
async function migrateSubmissionSupplements(): Promise<void> {
  logger.info("Starting migration of submission supplements...");

  const submissions = await query<{
    id: number;
    supplement_type: string | null;
    supplement_regimen: string | null;
  }>(
    "SELECT id, supplement_type, supplement_regimen FROM submissions WHERE supplement_type IS NOT NULL OR supplement_regimen IS NOT NULL"
  );

  for (const submission of submissions) {
    try {
      const types = parseJsonSafely<string[]>(submission.supplement_type, []);
      const regimens = parseJsonSafely<string[]>(
        submission.supplement_regimen,
        []
      );

      // Skip if both are empty
      if (types.length === 0 && regimens.length === 0) {
        continue;
      }

      // Handle mismatched array lengths (use empty string for missing values)
      const maxLength = Math.max(types.length, regimens.length);

      const insertStmt = await writeConn.prepare(`
        INSERT INTO submission_supplements
        (submission_id, supplement_type, supplement_regimen, display_order)
        VALUES (?, ?, ?, ?)
      `);

      for (let i = 0; i < maxLength; i++) {
        const type = types[i] || "";
        const regimen = regimens[i] || "";

        // Only insert if at least one value is non-empty
        if (type || regimen) {
          await insertStmt.run(submission.id, type, regimen, i);
          stats.supplements_migrated++;
        }
      }

      await insertStmt.finalize();

      logger.info(
        `Migrated ${maxLength} supplements for submission ${submission.id}`
      );
    } catch (err) {
      const error = `Failed to migrate supplements for submission ${submission.id}: ${err}`;
      logger.error(error);
      stats.errors.push(error);
    }
  }

  logger.info(`Completed migration of ${stats.supplements_migrated} supplements`);
}

/**
 * Migrate species external references from JSON to species_external_references table
 */
async function migrateSpeciesReferences(): Promise<void> {
  logger.info("Starting migration of species external references...");

  const species = await query<{
    group_id: number;
    external_references: string | null;
  }>(
    "SELECT group_id, external_references FROM species_name_group WHERE external_references IS NOT NULL"
  );

  for (const sp of species) {
    try {
      const references = parseJsonSafely<string[]>(sp.external_references, []);

      if (references.length === 0) {
        continue;
      }

      stats.species_processed++;

      const insertStmt = await writeConn.prepare(`
        INSERT INTO species_external_references
        (group_id, reference_url, display_order)
        VALUES (?, ?, ?)
      `);

      for (let i = 0; i < references.length; i++) {
        await insertStmt.run(sp.group_id, references[i], i);
        stats.references_migrated++;
      }

      await insertStmt.finalize();

      logger.info(
        `Migrated ${references.length} references for species group ${sp.group_id}`
      );
    } catch (err) {
      const error = `Failed to migrate references for species group ${sp.group_id}: ${err}`;
      logger.error(error);
      stats.errors.push(error);
    }
  }

  logger.info(
    `Completed migration of ${stats.references_migrated} references from ${stats.species_processed} species`
  );
}

/**
 * Migrate species image links from JSON to species_images table
 */
async function migrateSpeciesImages(): Promise<void> {
  logger.info("Starting migration of species image links...");

  const species = await query<{
    group_id: number;
    image_links: string | null;
  }>(
    "SELECT group_id, image_links FROM species_name_group WHERE image_links IS NOT NULL"
  );

  let speciesWithImages = 0;

  for (const sp of species) {
    try {
      const imageLinks = parseJsonSafely<string[]>(sp.image_links, []);

      if (imageLinks.length === 0) {
        continue;
      }

      speciesWithImages++;

      const insertStmt = await writeConn.prepare(`
        INSERT INTO species_images
        (group_id, image_url, display_order)
        VALUES (?, ?, ?)
      `);

      for (let i = 0; i < imageLinks.length; i++) {
        await insertStmt.run(sp.group_id, imageLinks[i], i);
        stats.species_images_migrated++;
      }

      await insertStmt.finalize();

      logger.info(
        `Migrated ${imageLinks.length} images for species group ${sp.group_id}`
      );
    } catch (err) {
      const error = `Failed to migrate images for species group ${sp.group_id}: ${err}`;
      logger.error(error);
      stats.errors.push(error);
    }
  }

  logger.info(
    `Completed migration of ${stats.species_images_migrated} image links from ${speciesWithImages} species`
  );
}

/**
 * Verify migration by checking row counts
 */
async function verifyMigration(): Promise<void> {
  logger.info("\n=== Verifying Migration ===");

  // Check submission_images
  const imageCount = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM submission_images"
  );
  logger.info(`submission_images table: ${imageCount[0].count} rows`);

  // Check submission_supplements
  const supplementCount = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM submission_supplements"
  );
  logger.info(`submission_supplements table: ${supplementCount[0].count} rows`);

  // Check species_external_references
  const refCount = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM species_external_references"
  );
  logger.info(`species_external_references table: ${refCount[0].count} rows`);

  // Check species_images
  const speciesImageCount = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM species_images"
  );
  logger.info(`species_images table: ${speciesImageCount[0].count} rows`);

  // Sample verification: check first submission with images
  const sampleSubmission = await query<{ id: number; images: string | null }>(
    "SELECT id, images FROM submissions WHERE images IS NOT NULL LIMIT 1"
  );

  if (sampleSubmission.length > 0) {
    const originalImages = parseJsonSafely<ImageMetadata[]>(
      sampleSubmission[0].images,
      []
    );
    const migratedImages = await query<{ r2_key: string }>(
      "SELECT r2_key FROM submission_images WHERE submission_id = ? ORDER BY display_order",
      [sampleSubmission[0].id]
    );

    logger.info(`\nSample verification for submission ${sampleSubmission[0].id}:`);
    logger.info(`  Original JSON: ${originalImages.length} images`);
    logger.info(`  Migrated table: ${migratedImages.length} rows`);

    if (originalImages.length === migratedImages.length) {
      logger.info("  ✓ Counts match!");
    } else {
      logger.warn("  ✗ Counts do not match!");
    }
  }
}

/**
 * Main migration function
 */
async function main() {
  logger.info("=== Starting JSON to Relational Migration ===\n");

  // Wait for database connection to initialize
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    // Run all migrations
    await migrateSubmissionImages();
    await migrateSubmissionSupplements();
    await migrateSpeciesReferences();
    await migrateSpeciesImages();

    // Verify migration
    await verifyMigration();

    // Print final statistics
    logger.info("\n=== Migration Complete ===");
    logger.info(`Submissions processed: ${stats.submissions_processed}`);
    logger.info(`Images migrated: ${stats.images_migrated}`);
    logger.info(`Supplements migrated: ${stats.supplements_migrated}`);
    logger.info(`Species processed: ${stats.species_processed}`);
    logger.info(`Species references migrated: ${stats.references_migrated}`);
    logger.info(`Species images migrated: ${stats.species_images_migrated}`);

    if (stats.errors.length > 0) {
      logger.error(`\n${stats.errors.length} errors occurred:`);
      stats.errors.forEach((err) => logger.error(`  - ${err}`));
      process.exit(1);
    } else {
      logger.info("\n✓ Migration completed successfully with no errors!");
      logger.info(
        "\nNext steps:"
      );
      logger.info("1. Review the migrated data in the new tables");
      logger.info("2. Verify data integrity");
      logger.info(
        "3. Uncomment the DROP COLUMN statements in migration 043 to remove old columns"
      );
    }
  } catch (err) {
    logger.error("Migration failed:", err);
    process.exit(1);
  }
}

main();
