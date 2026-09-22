/**
 * A Species' external references and images: enrichment that hangs off a
 * Species but is not part of its identity. The Species catalogue does not
 * write these; its detail view reads them from here.
 */
import { query, withTransaction } from "./conn";
import { logger } from "@/utils/logger";

export type SpeciesExternalReference = {
  id: number;
  group_id: number;
  reference_url: string;
  display_order: number;
};

export type SpeciesImage = {
  id: number;
  group_id: number;
  image_url: string;
  display_order: number;
  title: string | null;
  attribution: string | null;
  license: string | null;
  source: string | null;
  original_url: string | null;
};

// ============================================================================
// Species External References - New normalized table functions
// ============================================================================

/**
 * Get all external references for a species group
 */
export function getSpeciesExternalReferences(
  groupId: number
): Promise<SpeciesExternalReference[]> {
  return query<SpeciesExternalReference>(
    `SELECT * FROM species_external_references
     WHERE group_id = ?
     ORDER BY display_order ASC`,
    [groupId]
  );
}

/**
 * Set external references for a species group (replaces all existing)
 */
export async function setSpeciesExternalReferences(
  groupId: number,
  references: string[]
): Promise<void> {
  try {
    return await withTransaction(async (db) => {
      // Delete existing references
      const deleteStmt = await db.prepare(
        "DELETE FROM species_external_references WHERE group_id = ?"
      );
      await deleteStmt.run(groupId);
      await deleteStmt.finalize();

      // Insert new references
      if (references.length > 0) {
        const insertStmt = await db.prepare(`
          INSERT INTO species_external_references
          (group_id, reference_url, display_order)
          VALUES (?, ?, ?)
        `);

        for (let i = 0; i < references.length; i++) {
          await insertStmt.run(groupId, references[i], i);
        }

        await insertStmt.finalize();
      }
    });
  } catch (err) {
    logger.error("Failed to set species external references", err);
    throw new Error("Failed to set species external references");
  }
}

// ============================================================================
// Species Images - New normalized table functions
// ============================================================================

/**
 * Get all image links for a species group
 */
export function getSpeciesImages(groupId: number): Promise<SpeciesImage[]> {
  return query<SpeciesImage>(
    `SELECT * FROM species_images
     WHERE group_id = ?
     ORDER BY display_order ASC`,
    [groupId]
  );
}

/**
 * Set image links for a species group (replaces all existing)
 */
export async function setSpeciesImages(groupId: number, imageUrls: string[]): Promise<void> {
  try {
    return await withTransaction(async (db) => {
      // Delete existing images
      const deleteStmt = await db.prepare("DELETE FROM species_images WHERE group_id = ?");
      await deleteStmt.run(groupId);
      await deleteStmt.finalize();

      // Insert new images
      if (imageUrls.length > 0) {
        const insertStmt = await db.prepare(`
          INSERT INTO species_images
          (group_id, image_url, display_order)
          VALUES (?, ?, ?)
        `);

        for (let i = 0; i < imageUrls.length; i++) {
          await insertStmt.run(groupId, imageUrls[i], i);
        }

        await insertStmt.finalize();
      }
    });
  } catch (err) {
    logger.error("Failed to set species images", err);
    throw new Error("Failed to set species images");
  }
}

/**
 * Species image with metadata
 */
export interface SpeciesImageInput {
  image_url: string;
  display_order: number;
  source?: string;
  attribution?: string;
  license?: string;
  title?: string;
  original_url?: string;
}

/**
 * Set species images with metadata (source, attribution, license, etc.)
 *
 * Enhanced version of setSpeciesImages that supports full metadata tracking.
 * Use this for external data sync scripts that download images from Wikipedia, GBIF, etc.
 *
 * @param groupId - Species group ID
 * @param images - Array of images with metadata
 */
export async function setSpeciesImagesWithMetadata(
  groupId: number,
  images: SpeciesImageInput[]
): Promise<void> {
  try {
    return await withTransaction(async (db) => {
      // Delete existing images
      const deleteStmt = await db.prepare("DELETE FROM species_images WHERE group_id = ?");
      await deleteStmt.run(groupId);
      await deleteStmt.finalize();

      // Insert new images with metadata
      if (images.length > 0) {
        const insertStmt = await db.prepare(`
          INSERT INTO species_images
          (group_id, image_url, display_order, source, attribution, license, title, original_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const img of images) {
          await insertStmt.run(
            groupId,
            img.image_url,
            img.display_order,
            img.source || null,
            img.attribution || null,
            img.license || null,
            img.title || null,
            img.original_url || null
          );
        }

        await insertStmt.finalize();
      }
    });
  } catch (err) {
    logger.error("Failed to set species images with metadata", err);
    throw new Error("Failed to set species images with metadata");
  }
}
