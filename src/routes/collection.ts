import { createImageUpload } from "@/utils/image-upload-policy";
import { media, type UploadedMedia } from "@/services/media";
import { MulmRequest } from "@/sessions";
import { Response, Router } from "express";
import { z, ZodError } from "zod";
import { query, writeConn } from "@/db/conn";
import {
  getCollectionForMember,
  addToCollection,
  updateCollectionEntry,
  removeFromCollection,
  getCollectionEntry,
  getCollectionStats,
} from "@/db/collection";
import { findSpeciesById } from "@/species";
import { canSeeCaresRegistry } from "@/caresRegistry";
import {
  addToCollectionSchema,
  updateCollectionSchema,
  collectionViewSchema,
  memberIdParamSchema,
  entryIdParamSchema,
  canEditCollection,
} from "@/forms/collection";
import { logger } from "@/utils/logger";
import { ImageValidationError } from "@/utils/image-processor";
import { isR2Enabled, ImageMetadata } from "@/utils/r2-client";

const router = Router();

// Configure multer for memory storage (same as submission uploads)
const upload = createImageUpload(5);

/**
 * View a member's collection (public endpoint, JSON for HTMX)
 * GET /api/collection/:memberId
 */
router.get("/api/collection/:memberId", async (req: MulmRequest, res: Response) => {
  try {
    // Validate URL params
    const { memberId } = memberIdParamSchema.parse(req.params);

    // Validate query params
    const { includeRemoved } = collectionViewSchema.parse(req.query);

    const { viewer } = req;
    const includePrivate = viewer?.id === memberId;

    const collection = await getCollectionForMember(memberId, {
      includeRemoved: Boolean(includeRemoved),
      includePrivate,
      viewerId: viewer?.id,
      includeCaresRegistry: canSeeCaresRegistry(viewer),
    });

    const stats = await getCollectionStats(memberId);

    res.json({
      collection,
      stats,
      canEdit: viewer?.id === memberId,
    });
  } catch (error) {
    // Zod validation errors
    if (error instanceof ZodError) {
      const errorMessages = error.issues.map((issue) => issue.message).join(", ");
      res.status(400).json({ error: errorMessages });
      return;
    }

    logger.error("Failed to get collection", error);
    res.status(500).json({ error: "Failed to load collection" });
  }
});

/**
 * Add species to collection (requires login)
 * POST /api/collection
 */
router.post("/api/collection", async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const data = addToCollectionSchema.parse(req.body);
    await addToCollection(viewer.id, data);

    // Return HTML for HTMX to swap
    res.send(`
      <div class="alert alert-success" role="alert">
        <i class="fas fa-check-circle me-2"></i>
        Species added to your collection!
      </div>
      <script>
        // Close dialog after success
        setTimeout(() => {
          document.getElementById('dialog')?.remove();
          // Refresh collection display
          window.location.reload();
        }, 1000);
      </script>
    `);
  } catch (error) {
    // Zod validation errors
    if (error instanceof ZodError) {
      const errorMessages = error.issues.map((issue) => issue.message).join(", ");
      logger.error("Validation error adding to collection", error);
      res.status(400).send(`
        <div class="alert alert-warning" role="alert">
          <i class="fas fa-exclamation-triangle me-2"></i>
          ${errorMessages}
        </div>
      `);
      return;
    }

    if (error instanceof Error && error.message.includes("already in collection")) {
      res.status(400).send(`
        <div class="alert alert-warning" role="alert">
          <i class="fas fa-exclamation-triangle me-2"></i>
          This species is already in your collection.
        </div>
      `);
      return;
    }

    logger.error("Failed to add to collection", error);
    res.status(500).send(`
      <div class="alert alert-danger" role="alert">
        <i class="fas fa-times-circle me-2"></i>
        Failed to add species to collection. Please try again.
      </div>
    `);
  }
});

/**
 * Update collection entry (requires login + ownership)
 * PATCH /api/collection/:id
 */
router.patch("/api/collection/:id", async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    // Validate URL params
    const { id: entryId } = entryIdParamSchema.parse(req.params);

    // Verify ownership
    const entry = await getCollectionEntry(entryId, viewer.id);
    if (!entry || entry.member_id !== viewer.id) {
      res.status(403).send(`
        <div class="alert alert-danger" role="alert">
          <i class="fas fa-times-circle me-2"></i>
          Access denied. You can only edit your own collection entries.
        </div>
      `);
      return;
    }

    // Validate request body
    const updates = updateCollectionSchema.parse(req.body);
    await updateCollectionEntry(entryId, viewer.id, updates);

    // Return success message for HTMX
    res.send(`
      <div class="alert alert-success" role="alert">
        <i class="fas fa-check-circle me-2"></i>
        Collection entry updated!
      </div>
      <script>
        setTimeout(() => {
          document.getElementById('dialog')?.remove();
          window.location.reload();
        }, 1000);
      </script>
    `);
  } catch (error) {
    // Zod validation errors
    if (error instanceof ZodError) {
      const errorMessages = error.issues.map((issue) => issue.message).join(", ");
      logger.error("Validation error updating collection", error);
      res.status(400).send(`
        <div class="alert alert-warning" role="alert">
          <i class="fas fa-exclamation-triangle me-2"></i>
          ${errorMessages}
        </div>
      `);
      return;
    }

    logger.error("Failed to update collection entry", error);
    res.status(500).send(`
      <div class="alert alert-danger" role="alert">
        <i class="fas fa-times-circle me-2"></i>
        Failed to update entry. Please try again.
      </div>
    `);
  }
});

/**
 * Remove from collection (soft delete, requires login + ownership)
 * DELETE /api/collection/:id
 */
router.delete("/api/collection/:id", async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    // Validate URL params
    const { id: entryId } = entryIdParamSchema.parse(req.params);

    // Verify ownership
    const entry = await getCollectionEntry(entryId, viewer.id);
    if (!entry || entry.member_id !== viewer.id) {
      res.status(403).send(`
        <div class="alert alert-danger" role="alert">
          <i class="fas fa-times-circle me-2"></i>
          Access denied. You can only remove your own collection entries.
        </div>
      `);
      return;
    }

    await removeFromCollection(entryId, viewer.id);

    // Return success and trigger refresh
    res.send(`
      <div class="alert alert-info" role="alert">
        <i class="fas fa-info-circle me-2"></i>
        Species removed from your collection.
      </div>
      <script>
        setTimeout(() => {
          window.location.reload();
        }, 500);
      </script>
    `);
  } catch (error) {
    // Zod validation errors
    if (error instanceof ZodError) {
      const errorMessages = error.issues.map((issue) => issue.message).join(", ");
      res.status(400).json({ error: errorMessages });
      return;
    }

    logger.error("Failed to remove from collection", error);
    res.status(500).json({ error: "Failed to remove entry" });
  }
});

/**
 * Get add to collection dialog
 * GET /dialog/collection/add
 */
router.get("/dialog/collection/add", (req: MulmRequest, res: Response) => {
  res.render("dialog/collection-add", {
    viewer: req.viewer,
  });
});

/**
 * Get edit collection dialog
 * GET /dialog/collection/edit/:id
 */
router.get("/dialog/collection/edit/:id", async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res.status(401).send("Not authenticated");
    return;
  }

  try {
    // Validate URL params
    const { id: entryId } = entryIdParamSchema.parse(req.params);

    const entry = await getCollectionEntry(entryId, viewer.id);
    if (!entry || !canEditCollection(entry, viewer)) {
      res.status(403).send("Access denied - you can only edit your own collection entries");
      return;
    }

    res.render("dialog/collection-edit", {
      viewer,
      entry,
    });
  } catch (error) {
    // Zod validation errors
    if (error instanceof ZodError) {
      const errorMessages = error.issues.map((issue) => issue.message).join(", ");
      res.status(400).send(`Invalid entry ID: ${errorMessages}`);
      return;
    }

    logger.error("Failed to load collection entry for editing", error);
    res.status(500).send("Failed to load entry");
  }
});

/**
 * Get link collection dialog
 * GET /dialog/collection/link/:id
 */
router.get("/dialog/collection/link/:id", async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res.status(401).send("Not authenticated");
    return;
  }

  try {
    // Validate URL params
    const { id: entryId } = entryIdParamSchema.parse(req.params);

    const entry = await getCollectionEntry(entryId, viewer.id);
    if (!entry || !canEditCollection(entry, viewer)) {
      res.status(403).send("Access denied - you can only link your own collection entries");
      return;
    }

    // Only allow linking if it's NOT already linked to database
    if (entry.group_id) {
      res.status(400).send("This entry is already linked to a database species");
      return;
    }

    res.render("dialog/collection-link", {
      viewer,
      entry,
    });
  } catch (error) {
    // Zod validation errors
    if (error instanceof ZodError) {
      const errorMessages = error.issues.map((issue) => issue.message).join(", ");
      res.status(400).send(`Invalid entry ID: ${errorMessages}`);
      return;
    }

    logger.error("Failed to load collection entry for linking", error);
    res.status(500).send("Failed to load entry");
  }
});

/**
 * Link custom collection entry to database species
 * POST /api/collection/:id/link
 */
router.post("/api/collection/:id/link", async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    // Validate URL params
    const { id: entryId } = entryIdParamSchema.parse(req.params);

    // Verify ownership
    const entry = await getCollectionEntry(entryId, viewer.id);
    if (!entry || entry.member_id !== viewer.id) {
      res.status(403).render("partials/message", {
        message: "Access denied. You can only link your own collection entries.",
        type: "error",
      });
      return;
    }

    // Make sure it's not already linked
    if (entry.group_id) {
      res.status(400).render("partials/message", {
        message: "This entry is already linked to a database species.",
        type: "warning",
      });
      return;
    }

    // Validate the new group_id
    const { group_id } = z.object({
      group_id: z.coerce.number().int().positive("Please select a species from the database"),
    }).parse(req.body);

    // Verify the species actually exists in the database
    const species = await findSpeciesById(group_id);
    if (!species) {
      res.status(400).render("partials/message", {
        message: "The selected species does not exist in the database.",
        type: "error",
      });
      return;
    }

    // Check if user already has this species in their collection (avoid duplicates)
    const duplicate = await query<{ id: number }>(
      `SELECT id FROM species_collection
       WHERE member_id = ? AND group_id = ? AND removed_date IS NULL AND id != ?`,
      [viewer.id, group_id, entryId]
    );

    if (duplicate.length > 0) {
      res.status(400).render("partials/message", {
        message: "You already have this species in your collection. Please update the existing entry instead.",
        type: "warning",
      });
      return;
    }

    // Update the entry to link it to the database species
    // Clear custom names and set group_id (linking to database)
    const stmt = await writeConn.prepare(
      "UPDATE species_collection SET group_id = ?, common_name = NULL, scientific_name = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    );

    try {
      await stmt.run(group_id, entryId);
    } finally {
      await stmt.finalize();
    }

    // Return success - reload the page
    res.setHeader("HX-Refresh", "true");
    res.render("partials/message", {
      message: "Successfully linked to database species!",
      type: "success",
    });
  } catch (error) {
    // Zod validation errors
    if (error instanceof ZodError) {
      const errorMessages = error.issues.map((issue) => issue.message).join(", ");
      logger.error("Validation error linking collection entry", error);
      res.status(400).render("partials/message", {
        message: errorMessages,
        type: "error",
      });
      return;
    }

    logger.error("Failed to link collection entry", error);
    res.status(500).render("partials/message", {
      message: "Failed to link to database species. Please try again.",
      type: "error",
    });
  }
});

/**
 * Upload images for collection entry
 * POST /api/collection/:id/images
 */
router.post(
  "/api/collection/:id/images",
  upload.array("images", 5),
  async (req: MulmRequest, res: Response) => {
    const { viewer } = req;
    if (!viewer) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    // Check if R2 is configured
    if (!isR2Enabled()) {
      res.status(503).json({ error: "Image upload service is not configured" });
      return;
    }

    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      res.status(400).json({ error: "No files uploaded" });
      return;
    }

    const uploadedMedia: UploadedMedia[] = [];

    try {
      // Validate URL params
      const { id: entryId } = entryIdParamSchema.parse(req.params);

      // Verify ownership
      const entry = await getCollectionEntry(entryId, viewer.id);
      if (!entry || entry.member_id !== viewer.id) {
        res.status(403).json({
          error: "Access denied - you can only upload images to your own collection entries",
        });
        return;
      }

      // Check existing image count
      const existingImages = entry.images || [];
      if (existingImages.length + req.files.length > 5) {
        res.status(400).json({
          error: `Cannot upload ${req.files.length} images. You have ${existingImages.length} images already. Maximum is 5 total.`,
        });
        return;
      }

      const processedImages: ImageMetadata[] = [];
      const errors: string[] = [];

      // Process each uploaded file
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];

        try {
          const uploaded = await media.upload(file.buffer, {
            scope: "submissions",
            memberId: viewer.id,
            recordId: entryId,
            filename: file.originalname,
          });
          uploadedMedia.push(uploaded);
          processedImages.push(uploaded.metadata);
        } catch (error) {
          if (error instanceof ImageValidationError) {
            errors.push(`${file.originalname}: ${error.message}`);
          } else {
            logger.error("Image processing failed", error);
            errors.push(`${file.originalname}: Processing failed`);
          }
        }
      }

      // Update collection entry with new images
      if (processedImages.length > 0) {
        const allImages = [...existingImages, ...processedImages];
        await updateCollectionEntry(entryId, viewer.id, { images: allImages });
      }

      uploadedMedia.length = 0; // The committed collection entry owns these objects.

      // Return results
      res.json({
        success: true,
        images: processedImages,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      await Promise.all(uploadedMedia.map((uploaded) => uploaded.cleanup()));
      // Zod validation errors
      if (error instanceof ZodError) {
        const errorMessages = error.issues.map((issue) => issue.message).join(", ");
        res.status(400).json({ error: errorMessages });
        return;
      }

      logger.error("Failed to upload collection images", error);
      res.status(500).json({ error: "Failed to upload images" });
    }
  }
);

export default router;
