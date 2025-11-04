import { MulmRequest } from "@/sessions";
import { Response, Router } from "express";
import { ZodError } from "zod";
import {
  getCollectionForMember,
  addToCollection,
  updateCollectionEntry,
  removeFromCollection,
  getCollectionEntry,
  getCollectionStats,
} from "@/db/collection";
import {
  addToCollectionSchema,
  updateCollectionSchema,
  collectionViewSchema,
  memberIdParamSchema,
  entryIdParamSchema,
  canEditCollection,
} from "@/forms/collection";
import { logger } from "@/utils/logger";

const router = Router();

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
 * Upload images for collection entry
 * POST /api/collection/:id/images
 *
 * This endpoint reuses the existing image upload infrastructure
 * but associates images with a collection entry instead of a submission
 */
router.post("/api/collection/:id/images", async (req: MulmRequest, res: Response) => {
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
      res.status(403).json({ error: "Access denied - you can only upload images to your own collection entries" });
      return;
    }

    // The actual image processing will be handled by the existing upload module
    // This is just the endpoint that connects it to collections
    // We'll implement this integration in the next step

    res.status(501).json({
      error: "Image upload integration pending",
      note: "This will be implemented when we extend the upload module",
    });
  } catch (error) {
    // Zod validation errors
    if (error instanceof ZodError) {
      const errorMessages = error.issues.map((issue) => issue.message).join(", ");
      res.status(400).json({ error: errorMessages });
      return;
    }

    logger.error("Failed to upload collection images", error);
    res.status(500).json({ error: "Failed to upload images" });
  }
});

export default router;