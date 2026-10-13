import { createImageUpload } from "@/utils/image-upload-policy";
import { media, type UploadedMedia, imageVariantKeys } from "@/services/media";
import { MulmRequest } from "@/sessions";
import { Response, Router } from "express";
import { ZodError } from "zod";
import {
  registerForCares,
  CaresRefusal,
  updateCaresPhoto,
  getCaresRegistrations,
  getCaresEligibility,
  getCaresStats,
  isMemberCaresParticipant,
  getMemberCaresCount,
  createFryShare,
} from "@/db/cares";
import { getCollectionEntry } from "@/db/collection";
import { searchMembers as searchMembersDb } from "@/db/members";
import { caresRegistrationSchema, caresFryShareSchema } from "@/forms/cares";
import { logger } from "@/utils/logger";
import { ImageValidationError } from "@/utils/image-processor";
import { isR2Enabled } from "@/utils/r2-client";
import { requireCaresRegistry } from "@/caresRegistry";

const router = Router();

// Mounted at "/", so gate only the CARES paths, not every request passing through.
router.use(["/cares", "/dialog/cares", "/api/cares"], requireCaresRegistry);

// Configure multer for single photo upload
const upload = createImageUpload(1);

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
      res
        .status(401)
        .render("partials/message", {
          message: "Not authenticated. Please log in.",
          type: "error",
        });
      return;
    }

    if (!isR2Enabled()) {
      res
        .status(503)
        .render("partials/message", {
          message: "Image upload service is not configured.",
          type: "error",
        });
      return;
    }

    if (!req.file) {
      res
        .status(400)
        .render("partials/message", {
          message:
            "A photo is required for CARES registration. Please upload a side-view photo of your fish.",
          type: "warning",
        });
      return;
    }

    let uploaded: UploadedMedia | undefined;
    try {
      const { collection_entry_id } = caresRegistrationSchema.parse(req.body);

      const eligibility = await getCaresEligibility(collection_entry_id, viewer.id);
      if (!eligibility)
        throw new CaresRefusal("missing-entry", "Collection entry not found or access denied");
      if (!eligibility.eligible)
        throw new CaresRefusal("ineligible", "This species is not part of the CARES priority list");
      if (eligibility.registered)
        throw new CaresRefusal(
          "already-registered",
          "This species is already registered for CARES"
        );
      uploaded = await media.upload(req.file.buffer, {
        scope: "cares",
        memberId: viewer.id,
        recordId: collection_entry_id,
        filename: req.file.originalname,
      });
      const { key: originalKey, url: photoUrl } = uploaded.metadata;
      await registerForCares(collection_entry_id, viewer.id, originalKey, photoUrl);
      uploaded = undefined; // The committed registration now owns these objects.

      logger.info("CARES registration completed", {
        memberId: viewer.id,
        collectionEntryId: collection_entry_id,
        photoKey: originalKey,
      });

      // Return success with redirect
      res.render("partials/message", {
        message: "Gold seal earned! Species registered for CARES.",
        type: "success",
        reloadDelay: 1500,
      });
    } catch (error) {
      await uploaded?.cleanup();
      if (error instanceof ZodError) {
        const errorMessages = error.issues.map((issue) => issue.message).join(", ");
        res.status(400).render("partials/message", { message: errorMessages, type: "warning" });
        return;
      }

      if (error instanceof ImageValidationError) {
        res.status(400).render("partials/message", { message: error.message, type: "warning" });
        return;
      }

      if (error instanceof CaresRefusal) {
        res.status(400).render("partials/message", { message: error.message, type: "warning" });
        return;
      }

      logger.error("CARES registration failed", error);
      res
        .status(500)
        .render("partials/message", {
          message: "Registration failed. Please try again.",
          type: "error",
        });
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
      res.status(401).render("partials/message", { message: "Not authenticated.", type: "error" });
      return;
    }

    if (!isR2Enabled()) {
      res
        .status(503)
        .render("partials/message", {
          message: "Image upload service is not configured.",
          type: "error",
        });
      return;
    }

    if (!req.file) {
      res
        .status(400)
        .render("partials/message", { message: "Please upload a photo.", type: "warning" });
      return;
    }

    let uploaded: UploadedMedia | undefined;
    try {
      const entryId = parseInt(req.params.id);
      if (isNaN(entryId)) {
        res
          .status(400)
          .render("partials/message", { message: "Invalid entry ID.", type: "warning" });
        return;
      }

      const eligibility = await getCaresEligibility(entryId, viewer.id);
      if (!eligibility)
        throw new CaresRefusal("missing-entry", "Collection entry not found or access denied");
      if (!eligibility.registered)
        throw new CaresRefusal("not-registered", "This species is not registered for CARES");
      uploaded = await media.upload(req.file.buffer, {
        scope: "cares",
        memberId: viewer.id,
        recordId: entryId,
        filename: req.file.originalname,
      });
      const { key: originalKey, url: photoUrl } = uploaded.metadata;
      const { oldPhotoKey } = await updateCaresPhoto(entryId, viewer.id, originalKey, photoUrl);
      uploaded = undefined; // Never compensate the newly committed photo.
      if (oldPhotoKey) await media.cleanup(imageVariantKeys(oldPhotoKey));

      logger.info("CARES photo updated", {
        memberId: viewer.id,
        collectionEntryId: entryId,
        photoKey: originalKey,
      });

      res.render("partials/message", {
        message: "CARES photo updated!",
        type: "success",
        reloadDelay: 1000,
      });
    } catch (error) {
      await uploaded?.cleanup();
      if (error instanceof ImageValidationError) {
        res.status(400).render("partials/message", { message: error.message, type: "warning" });
        return;
      }

      if (error instanceof CaresRefusal) {
        res.status(400).render("partials/message", { message: error.message, type: "warning" });
        return;
      }

      logger.error("CARES photo update failed", error);
      res
        .status(500)
        .render("partials/message", {
          message: "Failed to update photo. Please try again.",
          type: "error",
        });
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

/**
 * GET /dialog/cares/fry-share
 * Show the fry sharing dialog for recording distribution of CARES species
 */
router.get("/dialog/cares/fry-share", async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res.status(401).send("Not authenticated");
    return;
  }

  try {
    const registrations = await getCaresRegistrations(viewer.id);
    if (registrations.length === 0) {
      res
        .status(400)
        .render("partials/message", {
          message: "You need to register at least one CARES species before recording a fry share.",
          type: "warning",
        });
      return;
    }

    res.render("dialog/cares-fry-share", {
      viewer,
      registrations,
    });
  } catch (error) {
    logger.error("Failed to load fry sharing dialog", error);
    res.status(500).send("Failed to load fry sharing form");
  }
});

/**
 * POST /api/cares/fry-share
 * Record a fry share for a CARES species
 */
router.post("/api/cares/fry-share", async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res
      .status(401)
      .render("partials/message", { message: "Not authenticated. Please log in.", type: "error" });
    return;
  }

  try {
    const data = caresFryShareSchema.parse(req.body);

    // Look up recipient member ID if they're a known BAS member
    let recipientMemberId: number | null = null;
    if (!data.recipient_club) {
      // Internal share - try to find member by name
      const members = await searchMembersDb(data.recipient_name, 1);
      const exactMatch = members.find(
        (m) => m.display_name.toLowerCase() === data.recipient_name.toLowerCase()
      );
      if (exactMatch) {
        recipientMemberId = exactMatch.id;
      }
    }

    await createFryShare(
      viewer.id,
      data.species_group_id,
      data.recipient_name,
      recipientMemberId,
      data.recipient_club,
      data.share_date,
      data.notes
    );

    const sealType = data.recipient_club ? "Red" : "Blue";
    logger.info("Fry share recorded", {
      memberId: viewer.id,
      speciesGroupId: data.species_group_id,
      recipientName: data.recipient_name,
      sealType,
    });

    res.render("partials/message", {
      message: `Fry share recorded! ${sealType} seal earned.`,
      type: "success",
      reloadDelay: 1500,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errorMessages = error.issues.map((issue) => issue.message).join(", ");
      res.status(400).render("partials/message", { message: errorMessages, type: "warning" });
      return;
    }

    if (error instanceof CaresRefusal) {
      res.status(400).render("partials/message", { message: error.message, type: "warning" });
      return;
    }

    logger.error("Fry share recording failed", error);
    res
      .status(500)
      .render("partials/message", {
        message: "Failed to record fry share. Please try again.",
        type: "error",
      });
  }
});

// Landing page
router.get("/cares", async (req: MulmRequest, res: Response) => {
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
    viewerId: viewer?.id,
  });
});

export default router;
