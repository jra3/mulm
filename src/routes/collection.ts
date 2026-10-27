import { createImageUpload } from "@/utils/image-upload-policy";
import { media, type UploadedMedia } from "@/services/media";
import { MulmRequest } from "@/sessions";
import { Response, Router } from "express";
import { z, ZodError } from "zod";
import {
  addToCollection,
  getCollectionForMember,
  updateCollectionEntry,
  removeFromCollection,
  getCollectionEntry,
  linkCollectionEntry,
  CollectionRefusal,
} from "@/db/collection";
import {
  addToCollectionSchema,
  updateCollectionSchema,
  entryIdParamSchema,
  addDialogQuerySchema,
  canEditCollection,
} from "@/forms/collection";
import { canonicalName, findSpeciesById, listNames } from "@/species";
import { logger } from "@/utils/logger";
import { ImageValidationError } from "@/utils/image-processor";
import { isR2Enabled, ImageMetadata } from "@/utils/r2-client";

const router = Router();

// Configure multer for memory storage (same as submission uploads)
const upload = createImageUpload(5);

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
    res.render("partials/message", {
      message: "Species added to your collection!",
      type: "success",
      reloadDelay: 1000,
    });
  } catch (error) {
    // Zod validation errors
    if (error instanceof ZodError) {
      const errorMessages = error.issues.map((issue) => issue.message).join(", ");
      logger.error("Validation error adding to collection", error);
      res.status(400).render("partials/message", { message: errorMessages, type: "warning" });
      return;
    }

    if (error instanceof CollectionRefusal) {
      res.status(400).render("partials/message", {
        message:
          error.code === "duplicate"
            ? "This species is already in your collection."
            : error.message,
        type: "warning",
      });
      return;
    }

    logger.error("Failed to add to collection", error);
    res.status(500).render("partials/message", {
      message: "Failed to add species to collection. Please try again.",
      type: "error",
    });
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

    // Validate request body; updateCollectionEntry checks ownership in its single read
    const updates = updateCollectionSchema.parse(req.body);
    await updateCollectionEntry(entryId, viewer.id, updates);

    // Return success message for HTMX
    res.render("partials/message", {
      message: "Collection entry updated!",
      type: "success",
      reloadDelay: 1000,
    });
  } catch (error) {
    // Zod validation errors
    if (error instanceof ZodError) {
      const errorMessages = error.issues.map((issue) => issue.message).join(", ");
      logger.error("Validation error updating collection", error);
      res.status(400).render("partials/message", { message: errorMessages, type: "warning" });
      return;
    }

    if (error instanceof CollectionRefusal) {
      const denied = error.code === "missing" || error.code === "forbidden";
      res.status(denied ? 403 : 400).render("partials/message", {
        message: denied
          ? "Access denied. You can only edit your own collection entries."
          : error.message,
        type: denied ? "error" : "warning",
      });
      return;
    }

    logger.error("Failed to update collection entry", error);
    res.status(500).render("partials/message", {
      message: "Failed to update entry. Please try again.",
      type: "error",
    });
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
      res.status(403).render("partials/message", {
        message: "Access denied. You can only remove your own collection entries.",
        type: "error",
      });
      return;
    }

    await removeFromCollection(entryId, viewer.id);

    // Return success and trigger refresh
    res.render("partials/message", {
      message: "Species removed from your collection.",
      type: "success",
      reloadDelay: 500,
    });
  } catch (error) {
    // Zod validation errors
    if (error instanceof ZodError) {
      const errorMessages = error.issues.map((issue) => issue.message).join(", ");
      res.status(400).json({ error: errorMessages });
      return;
    }

    if (error instanceof CollectionRefusal) {
      res
        .status(error.code === "missing" || error.code === "forbidden" ? 403 : 400)
        .render("partials/message", { message: error.message, type: "warning" });
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
router.get("/dialog/collection/add", async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res.status(401).send("Not authenticated");
    return;
  }

  try {
    // ?species=<group_id> preselects a Species; a bad or stale id falls back
    // to the generic dialog with a notice, so the Member can still search.
    const parsed = addDialogQuerySchema.safeParse(req.query);
    const speciesId = parsed.success ? parsed.data.species : undefined;
    const requested = !parsed.success || speciesId !== undefined;
    const species = speciesId ? await findSpeciesById(speciesId) : undefined;

    let preselected;
    let alreadyKept = false;
    if (species) {
      const scientific = canonicalName(species);
      const common = (await listNames(species.group_id)).common[0]?.name ?? null;
      preselected = {
        group_id: species.group_id,
        text: common ? `${common} (${scientific})` : scientific,
        common_name: common,
        scientific_name: scientific,
      };
      const collection = await getCollectionForMember(viewer.id, { includePrivate: true });
      alreadyKept = collection.some((entry) => entry.group_id === species.group_id);
    }

    res.render("dialog/collection-add", {
      viewer,
      preselected,
      alreadyKept,
      speciesNotFound: requested && !species,
    });
  } catch (error) {
    logger.error("Failed to load add-to-collection dialog", error);
    res.status(500).send("Failed to load dialog");
  }
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

    const { group_id } = z
      .object({
        group_id: z.coerce.number().int().positive("Please select a species from the database"),
      })
      .parse(req.body);
    await linkCollectionEntry(entryId, viewer.id, group_id);

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

    if (error instanceof CollectionRefusal) {
      const denied = error.code === "missing" || error.code === "forbidden";
      res.status(denied ? 403 : 400).render("partials/message", {
        message: denied
          ? "Access denied. You can only link your own collection entries."
          : error.code === "duplicate"
            ? "You already have this species in your collection. Please update the existing entry instead."
            : error.message,
        type: denied || error.code === "missing-species" ? "error" : "warning",
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
