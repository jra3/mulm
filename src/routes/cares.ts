import { MulmRequest } from "@/sessions";
import { Response, Router } from "express";
import { ZodError } from "zod";
import multer from "multer";
import crypto from "crypto";
import {
  registerForCares,
  updateCaresPhoto,
  getCaresRegistrations,
  getCaresEligibility,
  getCaresStats,
  isMemberCaresParticipant,
  getMemberCaresCount,
} from "@/db/cares";
import { getCollectionEntry } from "@/db/collection";
import { caresRegistrationSchema } from "@/forms/cares";
import { logger } from "@/utils/logger";
import { processImage, ImageValidationError } from "@/utils/image-processor";
import {
  isR2Enabled,
  getPublicUrl,
  uploadToR2,
  deleteImage,
} from "@/utils/r2-client";

const router = Router();

// Configure multer for single photo upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, and WebP images are allowed."));
    }
  },
});

/**
 * Generate a unique key for CARES photos
 */
function generateCaresPhotoKey(memberId: number, entryId: number, filename: string): string {
  const timestamp = Date.now();
  const hash = crypto.randomBytes(8).toString("hex");
  const extension = filename.split(".").pop()?.toLowerCase() || "jpg";
  return `cares/${memberId}/${entryId}/${timestamp}-${hash}.${extension}`;
}

/**
 * GET /dialog/cares/register/:id
 * Show the CARES registration dialog for a collection entry
 */
router.get("/dialog/cares/register/:id", async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res.status(401).send("Not authenticated");
    return;
  }

  try {
    const entryId = parseInt(req.params.id);
    if (isNaN(entryId)) {
      res.status(400).send("Invalid entry ID");
      return;
    }

    const entry = await getCollectionEntry(entryId, viewer.id);
    if (!entry || entry.member_id !== viewer.id) {
      res.status(403).send("Access denied");
      return;
    }

    if (!entry.group_id || !entry.species?.is_cares_species) {
      res.status(400).send("This species is not eligible for CARES registration");
      return;
    }

    const eligibility = await getCaresEligibility(entryId, viewer.id);
    if (eligibility?.registered) {
      res.render("dialog/cares-register", {
        viewer,
        entry,
        isUpdate: true,
        photoUrl: eligibility.photoUrl,
      });
      return;
    }

    res.render("dialog/cares-register", {
      viewer,
      entry,
      isUpdate: false,
      photoUrl: null,
    });
  } catch (error) {
    logger.error("Failed to load CARES registration dialog", error);
    res.status(500).send("Failed to load registration form");
  }
});

/**
 * POST /api/cares/register
 * Register a collection entry for CARES with photo upload
 */
router.post(
  "/api/cares/register",
  upload.single("photo"),
  async (req: MulmRequest, res: Response) => {
    const { viewer } = req;
    if (!viewer) {
      res.status(401).send(`
        <div class="alert alert-danger" role="alert">
          <i class="fas fa-times-circle me-2"></i>
          Not authenticated. Please log in.
        </div>
      `);
      return;
    }

    if (!isR2Enabled()) {
      res.status(503).send(`
        <div class="alert alert-danger" role="alert">
          <i class="fas fa-times-circle me-2"></i>
          Image upload service is not configured.
        </div>
      `);
      return;
    }

    if (!req.file) {
      res.status(400).send(`
        <div class="alert alert-warning" role="alert">
          <i class="fas fa-exclamation-triangle me-2"></i>
          A photo is required for CARES registration. Please upload a side-view photo of your fish.
        </div>
      `);
      return;
    }

    try {
      const { collection_entry_id } = caresRegistrationSchema.parse(req.body);

      // Process the image
      const processed = await processImage(req.file.buffer, {
        preferWebP: false,
      });

      // Generate keys and upload to R2
      const baseKey = generateCaresPhotoKey(viewer.id, collection_entry_id, req.file.originalname);
      const originalKey = baseKey.replace(/\.(jpg|jpeg|png|webp)$/i, "-original.$1");
      const mediumKey = baseKey.replace(/\.(jpg|jpeg|png|webp)$/i, "-medium.$1");
      const thumbnailKey = baseKey.replace(/\.(jpg|jpeg|png|webp)$/i, "-thumb.$1");

      await Promise.all([
        uploadToR2(originalKey, processed.original.buffer, `image/${processed.original.format}`),
        uploadToR2(mediumKey, processed.medium.buffer, `image/${processed.medium.format}`),
        uploadToR2(thumbnailKey, processed.thumbnail.buffer, `image/${processed.thumbnail.format}`),
      ]);

      const photoUrl = getPublicUrl(originalKey);

      // Register for CARES
      await registerForCares(collection_entry_id, viewer.id, originalKey, photoUrl);

      logger.info("CARES registration completed", {
        memberId: viewer.id,
        collectionEntryId: collection_entry_id,
        photoKey: originalKey,
      });

      // Return success with redirect
      res.send(`
        <div class="alert alert-success" role="alert">
          <i class="fas fa-check-circle me-2"></i>
          Gold seal earned! Species registered for CARES.
        </div>
        <script>
          setTimeout(function() {
            var dialog = document.getElementById('dialog');
            if (dialog) dialog.remove();
            window.location.reload();
          }, 1500);
        </script>
      `);
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessages = error.issues.map((issue) => issue.message).join(", ");
        res.status(400).send(`
          <div class="alert alert-warning" role="alert">
            <i class="fas fa-exclamation-triangle me-2"></i>
            ${errorMessages}
          </div>
        `);
        return;
      }

      if (error instanceof ImageValidationError) {
        res.status(400).send(`
          <div class="alert alert-warning" role="alert">
            <i class="fas fa-exclamation-triangle me-2"></i>
            ${error.message}
          </div>
        `);
        return;
      }

      if (error instanceof Error) {
        // Known business logic errors
        if (
          error.message.includes("not part of the CARES") ||
          error.message.includes("already registered") ||
          error.message.includes("not found") ||
          error.message.includes("Only species linked")
        ) {
          res.status(400).send(`
            <div class="alert alert-warning" role="alert">
              <i class="fas fa-exclamation-triangle me-2"></i>
              ${error.message}
            </div>
          `);
          return;
        }
      }

      logger.error("CARES registration failed", error);
      res.status(500).send(`
        <div class="alert alert-danger" role="alert">
          <i class="fas fa-times-circle me-2"></i>
          Registration failed. Please try again.
        </div>
      `);
    }
  }
);

/**
 * POST /api/cares/:id/photo
 * Update the CARES registration photo
 */
router.post(
  "/api/cares/:id/photo",
  upload.single("photo"),
  async (req: MulmRequest, res: Response) => {
    const { viewer } = req;
    if (!viewer) {
      res.status(401).send(`
        <div class="alert alert-danger" role="alert">
          <i class="fas fa-times-circle me-2"></i>
          Not authenticated.
        </div>
      `);
      return;
    }

    if (!isR2Enabled()) {
      res.status(503).send(`
        <div class="alert alert-danger" role="alert">
          <i class="fas fa-times-circle me-2"></i>
          Image upload service is not configured.
        </div>
      `);
      return;
    }

    if (!req.file) {
      res.status(400).send(`
        <div class="alert alert-warning" role="alert">
          <i class="fas fa-exclamation-triangle me-2"></i>
          Please upload a photo.
        </div>
      `);
      return;
    }

    try {
      const entryId = parseInt(req.params.id);
      if (isNaN(entryId)) {
        res.status(400).send(`
          <div class="alert alert-warning" role="alert">
            <i class="fas fa-exclamation-triangle me-2"></i>
            Invalid entry ID.
          </div>
        `);
        return;
      }

      // Process the image
      const processed = await processImage(req.file.buffer, {
        preferWebP: false,
      });

      // Generate keys and upload to R2
      const baseKey = generateCaresPhotoKey(viewer.id, entryId, req.file.originalname);
      const originalKey = baseKey.replace(/\.(jpg|jpeg|png|webp)$/i, "-original.$1");
      const mediumKey = baseKey.replace(/\.(jpg|jpeg|png|webp)$/i, "-medium.$1");
      const thumbnailKey = baseKey.replace(/\.(jpg|jpeg|png|webp)$/i, "-thumb.$1");

      await Promise.all([
        uploadToR2(originalKey, processed.original.buffer, `image/${processed.original.format}`),
        uploadToR2(mediumKey, processed.medium.buffer, `image/${processed.medium.format}`),
        uploadToR2(thumbnailKey, processed.thumbnail.buffer, `image/${processed.thumbnail.format}`),
      ]);

      const photoUrl = getPublicUrl(originalKey);

      // Update the photo
      const { oldPhotoKey } = await updateCaresPhoto(entryId, viewer.id, originalKey, photoUrl);

      // Clean up old photo from R2
      if (oldPhotoKey) {
        const oldMediumKey = oldPhotoKey.replace("-original", "-medium");
        const oldThumbKey = oldPhotoKey.replace("-original", "-thumb");
        await Promise.all([
          deleteImage(oldPhotoKey).catch(() => {}),
          deleteImage(oldMediumKey).catch(() => {}),
          deleteImage(oldThumbKey).catch(() => {}),
        ]);
      }

      logger.info("CARES photo updated", {
        memberId: viewer.id,
        collectionEntryId: entryId,
        photoKey: originalKey,
      });

      res.send(`
        <div class="alert alert-success" role="alert">
          <i class="fas fa-check-circle me-2"></i>
          CARES photo updated!
        </div>
        <script>
          setTimeout(function() {
            var dialog = document.getElementById('dialog');
            if (dialog) dialog.remove();
            window.location.reload();
          }, 1000);
        </script>
      `);
    } catch (error) {
      if (error instanceof ImageValidationError) {
        res.status(400).send(`
          <div class="alert alert-warning" role="alert">
            <i class="fas fa-exclamation-triangle me-2"></i>
            ${error.message}
          </div>
        `);
        return;
      }

      if (error instanceof Error) {
        if (
          error.message.includes("not found") ||
          error.message.includes("not registered")
        ) {
          res.status(400).send(`
            <div class="alert alert-warning" role="alert">
              <i class="fas fa-exclamation-triangle me-2"></i>
              ${error.message}
            </div>
          `);
          return;
        }
      }

      logger.error("CARES photo update failed", error);
      res.status(500).send(`
        <div class="alert alert-danger" role="alert">
          <i class="fas fa-times-circle me-2"></i>
          Failed to update photo. Please try again.
        </div>
      `);
    }
  }
);

/**
 * GET /api/cares/registrations/:memberId
 * Get all CARES registrations for a member (JSON)
 */
router.get("/api/cares/registrations/:memberId", async (req: MulmRequest, res: Response) => {
  try {
    const memberId = parseInt(req.params.memberId);
    if (isNaN(memberId)) {
      res.status(400).json({ error: "Invalid member ID" });
      return;
    }

    const registrations = await getCaresRegistrations(memberId);
    res.json({ registrations });
  } catch (error) {
    logger.error("Failed to get CARES registrations", error);
    res.status(500).json({ error: "Failed to load registrations" });
  }
});

// Landing page
router.get("/", async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  const isLoggedIn = Boolean(viewer);

  const stats = await getCaresStats();

  let isParticipant = false;
  let memberSpeciesCount = 0;

  if (viewer) {
    [isParticipant, memberSpeciesCount] = await Promise.all([
      isMemberCaresParticipant(viewer.id),
      getMemberCaresCount(viewer.id),
    ]);
  }

  res.render("cares", {
    title: "CARES Fish Preservation Program",
    isLoggedIn,
    stats,
    isParticipant,
    memberSpeciesCount,
  });
});

export default router;
