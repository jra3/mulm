import express from 'express';
import multer from 'multer';
import { MulmRequest } from '../../sessions';
import { processImage, ImageValidationError } from '../../utils/image-processor';
import { 
  isR2Enabled, 
  generateImageKey, 
  getPublicUrl,
  deleteImage,
  uploadToR2
} from '../../utils/r2-client';
import { logger } from '../../utils/logger';
import { updateOne, query } from '../../db/conn';
import { ImageMetadata } from '../../utils/r2-client';
import {
  getUploadRateLimiters,
  deleteRateLimiter,
  progressRateLimiter
} from '../../middleware/rateLimiter';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 5 // Max 5 files at once
  },
  fileFilter: (req, file, cb) => {
    // Basic MIME type check (will validate magic bytes later)
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'));
    }
  }
});

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
  setTimeout(() => {
    uploadProgress.delete(uploadId);
  }, 5 * 60 * 1000);
}

/**
 * POST /api/upload/image
 * Upload and process images for submission
 */
router.post(
  '/image',
  ...getUploadRateLimiters(),
  upload.array('images', 5),
  async (req: MulmRequest, res): Promise<void> => {
    const { viewer } = req;
  
    // Check authentication
    if (!viewer) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
  
    // Check if R2 is configured
    if (!isR2Enabled()) {
      res.status(503).json({ error: 'Image upload service is not configured' });
      return;
    }
  
    const uploadId = (req.body as { uploadId?: string }).uploadId || generateUploadId();
    const submissionId = parseInt((req.body as { submissionId: string }).submissionId);
  
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }
  
    const processedImages: ImageMetadata[] = [];
    const errors: string[] = [];
  
    try {
      updateProgress(uploadId, 'processing', 10, 'Starting image processing...');
    
      // Process each uploaded file
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const fileProgress = 10 + (i * 80 / req.files.length);
      
        try {
          updateProgress(uploadId, 'processing', fileProgress, `Processing image ${i + 1} of ${req.files.length}`);
        
          // Process the image
          const processed = await processImage(file.buffer, {
            preferWebP: (req.body as { preferWebP?: string }).preferWebP === 'true'
          });
        
          // Generate unique keys for each size
          const baseKey = generateImageKey(viewer.id, submissionId || 0, file.originalname);
          const originalKey = baseKey.replace(/\.(jpg|jpeg|png|webp)$/i, '-original.$1');
          const mediumKey = baseKey.replace(/\.(jpg|jpeg|png|webp)$/i, '-medium.$1');
          const thumbnailKey = baseKey.replace(/\.(jpg|jpeg|png|webp)$/i, '-thumb.$1');
        
          updateProgress(uploadId, 'uploading', fileProgress + 10, `Uploading image ${i + 1} to storage...`);
        
          // Upload all sizes to R2
          await Promise.all([
            uploadToR2(originalKey, processed.original.buffer, `image/${processed.original.format}`),
            uploadToR2(mediumKey, processed.medium.buffer, `image/${processed.medium.format}`),
            uploadToR2(thumbnailKey, processed.thumbnail.buffer, `image/${processed.thumbnail.format}`)
          ]);
        
          // Create metadata entry
          const metadata: ImageMetadata = {
            key: originalKey,
            url: getPublicUrl(originalKey),
            size: processed.original.size,
            uploadedAt: new Date().toISOString(),
            contentType: `image/${processed.original.format}`
          };
        
          processedImages.push(metadata);
        
          logger.info('Image uploaded successfully', {
            memberId: viewer.id,
            submissionId,
            key: originalKey,
            size: processed.original.size
          });
        
        } catch (error) {
          if (error instanceof ImageValidationError) {
            errors.push(`${file.originalname}: ${error.message}`);
          } else {
            logger.error('Image processing failed', error);
            errors.push(`${file.originalname}: Processing failed`);
          }
        }
      }
    
      updateProgress(uploadId, 'complete', 100, 'Upload complete');
    
      // If this is for a submission, update the database
      if (submissionId && processedImages.length > 0) {
        try {
        // Get existing images
          const [submission] = await query<{ images: string | null }>(
            'SELECT images FROM submissions WHERE id = ?',
            [submissionId]
          );
        
          if (submission) {
            const existingImages = submission.images ? JSON.parse(submission.images) as ImageMetadata[] : [];
            const allImages = [...existingImages, ...processedImages];
          
            // Update submission with new images
            await updateOne(
              'submissions',
              { id: submissionId },
              { images: JSON.stringify(allImages) }
            );
          }
        } catch (error) {
          logger.error('Failed to update submission with images', error);
        }
      }
    
      // Return results
      res.json({
        success: true,
        uploadId,
        images: processedImages,
        errors: errors.length > 0 ? errors : undefined
      });
    
    } catch (error) {
      logger.error('Upload failed', error);
      updateProgress(uploadId, 'error', 0, 'Upload failed');
      res.status(500).json({ 
        error: 'Upload failed', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

/**
 * GET /api/upload/progress/:uploadId
 * Server-sent events endpoint for upload progress
 */
router.get('/progress/:uploadId', progressRateLimiter, (req: MulmRequest, res) => {
  const { uploadId } = req.params;
  
  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Disable Nginx buffering
  });
  
  // Send initial connection message
  res.write('data: {"stage":"connected","percent":0,"message":"Connected"}\n\n');
  
  // Set up interval to send progress updates
  const interval = setInterval(() => {
    const progress = uploadProgress.get(uploadId);
    
    if (progress) {
      res.write(`data: ${JSON.stringify(progress)}\n\n`);
      
      // Close connection when upload is complete or errored
      if (progress.stage === 'complete' || progress.stage === 'error') {
        clearInterval(interval);
        res.end();
      }
    }
  }, 500);
  
  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

/**
 * DELETE /api/upload/image/:key
 * Delete an uploaded image
 */
router.delete('/image/:key', deleteRateLimiter, async (req: MulmRequest, res): Promise<void> => {
  const { viewer } = req;
  
  if (!viewer) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  
  const { key } = req.params;
  
  try {
    // Verify the user owns this image (check if it's in their submissions)
    const [submission] = await query<{ images: string }>(
      `SELECT images FROM submissions 
       WHERE member_id = ? AND images LIKE ?`,
      [viewer.id, `%${key}%`]
    );
    
    if (!submission) {
      res.status(403).json({ error: 'Image not found or access denied' });
      return;
    }
    
    // Delete from R2
    await deleteImage(key);
    
    // Also delete the other sizes
    const mediumKey = key.replace('-original', '-medium');
    const thumbKey = key.replace('-original', '-thumb');
    await Promise.all([
      deleteImage(mediumKey).catch(() => {}), // Ignore errors for variants
      deleteImage(thumbKey).catch(() => {})
    ]);
    
    // Update submission to remove this image
    const images = JSON.parse(submission.images) as ImageMetadata[];
    const updatedImages = images.filter((img) => img.key !== key);
    
    await updateOne(
      'submissions',
      { member_id: viewer.id, images: submission.images },
      { images: JSON.stringify(updatedImages) }
    );
    
    res.json({ success: true });
    
  } catch (error) {
    logger.error('Failed to delete image', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

export default router;