import { createImageUpload } from "../../utils/image-upload-policy";
import { media, type UploadedMedia } from "../../services/media";
import express from "express";
import { MulmRequest } from "../../sessions";
import { ImageValidationError } from "../../utils/image-processor";
import { isR2Enabled, deleteImage } from "../../utils/r2-client";
import { logger } from "../../utils/logger";
import { withTransaction } from "../../db/conn";
import { ImageMetadata } from "../../utils/r2-client";
import {
  getUploadRateLimiters,
  deleteRateLimiter,
  progressRateLimiter,
} from "../../middleware/rateLimiter";
import { addSubmissionImages, deleteSubmissionImage } from "../../db/submissions";

const router = express.Router();

// Configure multer for memory storage
const upload = createImageUpload(5);

// Progress tracking store (in production, use Redis or similar)
const uploadProgress = new Map<string, { stage: string; percent: number; message: string }>();

/**
 * Generate a unique upload session ID
 */
function generateUploadId(): string {
  return `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Update upload progress
 */
function updateProgress(uploadId: string, stage: string, percent: number, message: string) {
  uploadProgress.set(uploadId, { stage, percent, message });

  // Clean up old progress entries after 5 minutes
  setTimeout(
    () => {
      uploadProgress.delete(uploadId);
    },
    5 * 60 * 1000
  ).unref();
}

/**
 * POST /api/upload/image
 * Upload and process images for submission
 */
router.post(
  "/image",
  ...getUploadRateLimiters(),
  upload.array("images", 5),
  async (req: MulmRequest, res): Promise<void> => {
    const { viewer } = req;

    // Check authentication
    if (!viewer) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Check if R2 is configured
    if (!isR2Enabled()) {
      res.status(503).json({ error: "Image upload service is not configured" });
      return;
    }

    const uploadId = (req.body as { uploadId?: string }).uploadId || generateUploadId();
    const submissionId = parseInt((req.body as { submissionId: string }).submissionId);

    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      res.status(400).json({ error: "No files uploaded" });
      return;
    }

    const processedImages: ImageMetadata[] = [];
    const uploadedMedia: UploadedMedia[] = [];
    const errors: string[] = [];

    try {
      updateProgress(uploadId, "processing", 10, "Starting image processing...");

      // Process each uploaded file
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const fileProgress = 10 + (i * 80) / req.files.length;

        try {
          updateProgress(
            uploadId,
            "processing",
            fileProgress,
            `Processing image ${i + 1} of ${req.files.length}`
          );

          const uploaded = await media.upload(
            file.buffer,
            {
              scope: "submissions",
              memberId: viewer.id,
              recordId: submissionId || 0,
              filename: file.originalname,
            },
            {
              preferWebP: (req.body as { preferWebP?: string }).preferWebP === "true",
              onUploading: () =>
                updateProgress(
                  uploadId,
                  "uploading",
                  fileProgress + 10,
                  `Uploading image ${i + 1} to storage...`
                ),
            }
          );
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

      // Commit the successful files as a batch, after every network write has settled.
      if (submissionId && processedImages.length > 0) {
        await addSubmissionImages(
          submissionId,
          processedImages.map((img) => ({
            r2_key: img.key,
            public_url: img.url,
            file_size: img.size,
            uploaded_at: img.uploadedAt,
            content_type: img.contentType || "image/jpeg",
          }))
        );
      }
      uploadedMedia.length = 0; // Persistence (or the staged response) owns the objects now.
      updateProgress(uploadId, "complete", 100, "Upload complete");

      // Return results
      res.json({
        success: true,
        uploadId,
        images: processedImages,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      await Promise.all(uploadedMedia.map((uploaded) => uploaded.cleanup()));
      logger.error("Upload failed", error);
      updateProgress(uploadId, "error", 0, "Upload failed");
      res.status(500).json({
        error: "Upload failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

/**
 * GET /api/upload/progress/:uploadId
 * Server-sent events endpoint for upload progress
 */
router.get("/progress/:uploadId", progressRateLimiter, (req: MulmRequest, res) => {
  const { uploadId } = req.params;

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // Disable Nginx buffering
  });

  // Send initial connection message
  res.write('data: {"stage":"connected","percent":0,"message":"Connected"}\n\n');

  // Set up interval to send progress updates
  const interval = setInterval(() => {
    const progress = uploadProgress.get(uploadId);

    if (progress) {
      res.write(`data: ${JSON.stringify(progress)}\n\n`);

      // Close connection when upload is complete or errored
      if (progress.stage === "complete" || progress.stage === "error") {
        clearInterval(interval);
        res.end();
      }
    }
  }, 500);

  // Clean up on client disconnect
  req.on("close", () => {
    clearInterval(interval);
    res.end();
  });
});

/**
 * DELETE /api/upload/image/:key
 * Delete an uploaded image
 */
router.delete("/image/:key", deleteRateLimiter, async (req: MulmRequest, res): Promise<void> => {
  const { viewer } = req;

  if (!viewer) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const { key } = req.params;

  try {
    // Verify the user owns this image and get submission data
    let submissionId: number | undefined;

    await withTransaction(async (db) => {
      const stmt = await db.prepare(`
        SELECT s.id
        FROM submissions s
        JOIN submission_images si ON s.id = si.submission_id
        WHERE s.member_id = ? AND si.r2_key = ?
      `);
      try {
        const submission = await stmt.get<{ id: number }>(viewer.id, key);

        if (!submission) {
          throw new Error("Image not found or access denied");
        }

        submissionId = submission.id;
      } finally {
        await stmt.finalize();
      }
    });

    if (!submissionId) {
      res.status(403).json({ error: "Image not found or access denied" });
      return;
    }

    // Delete from R2
    await deleteImage(key);

    // Also delete the other sizes
    const mediumKey = key.replace("-original", "-medium");
    const thumbKey = key.replace("-original", "-thumb");
    await Promise.all([
      deleteImage(mediumKey).catch(() => {}), // Ignore errors for variants
      deleteImage(thumbKey).catch(() => {}),
    ]);

    // Delete from submission_images table
    await deleteSubmissionImage(submissionId, key);

    res.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete image", error);
    if (error instanceof Error && error.message === "Image not found or access denied") {
      res.status(403).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Failed to delete image" });
    }
  }
});

export default router;
