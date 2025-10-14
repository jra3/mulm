import sharp from "sharp";
import { logger } from "./logger";

export interface ProcessedImage {
  buffer: Buffer;
  format: string;
  width: number;
  height: number;
  size: number;
}

export interface ProcessingResult {
  original: ProcessedImage;
  medium: ProcessedImage;
  thumbnail: ProcessedImage;
  metadata: {
    originalWidth: number;
    originalHeight: number;
    originalSize: number;
    originalFormat: string;
    processingTimeMs: number;
  };
}

const MAX_DIMENSION = 2048;
const MEDIUM_WIDTH = 800;
const THUMBNAIL_SIZE = 150;
const JPEG_QUALITY = 85;
const WEBP_QUALITY = 80;

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageValidationError";
  }
}

/**
 * Validate image buffer using magic bytes
 */
export async function validateImageBuffer(buffer: Buffer): Promise<void> {
  // Check magic bytes for common image formats
  const magicBytes = buffer.subarray(0, 12);

  // JPEG: FF D8 FF
  const isJPEG = magicBytes[0] === 0xff && magicBytes[1] === 0xd8 && magicBytes[2] === 0xff;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const isPNG =
    magicBytes[0] === 0x89 &&
    magicBytes[1] === 0x50 &&
    magicBytes[2] === 0x4e &&
    magicBytes[3] === 0x47;

  // WebP: RIFF....WEBP
  const isWebP =
    magicBytes[0] === 0x52 &&
    magicBytes[1] === 0x49 &&
    magicBytes[2] === 0x46 &&
    magicBytes[3] === 0x46 &&
    magicBytes[8] === 0x57 &&
    magicBytes[9] === 0x45 &&
    magicBytes[10] === 0x42 &&
    magicBytes[11] === 0x50;

  if (!isJPEG && !isPNG && !isWebP) {
    throw new ImageValidationError("Invalid image format. Only JPEG, PNG, and WebP are supported.");
  }

  // Additional validation using Sharp metadata
  try {
    const metadata = await sharp(buffer).metadata();

    if (!metadata.width || !metadata.height) {
      throw new ImageValidationError("Invalid image: unable to read dimensions");
    }

    if (metadata.width < 400 || metadata.height < 400) {
      throw new ImageValidationError("Image too small. Minimum dimensions are 400x400 pixels.");
    }

    if (metadata.width > 4000 || metadata.height > 4000) {
      throw new ImageValidationError("Image too large. Maximum dimensions are 4000x4000 pixels.");
    }
  } catch (error) {
    if (error instanceof ImageValidationError) {
      throw error;
    }
    throw new ImageValidationError("Invalid image file");
  }
}

/**
 * Process a single image size variant
 */
async function processVariant(
  input: Buffer,
  options: {
    width?: number;
    height?: number;
    fit?: keyof sharp.FitEnum;
    format: "jpeg" | "webp";
    quality: number;
  }
): Promise<ProcessedImage> {
  const sharpInstance = sharp(input);

  // Strip EXIF data for privacy
  sharpInstance.rotate(); // Auto-rotate based on EXIF, then strip

  // Resize if dimensions specified
  if (options.width || options.height) {
    sharpInstance.resize({
      width: options.width,
      height: options.height,
      fit: options.fit || "inside",
      withoutEnlargement: true,
    });
  }

  // Convert to specified format
  if (options.format === "webp") {
    sharpInstance.webp({ quality: options.quality });
  } else {
    sharpInstance.jpeg({ quality: options.quality, progressive: true });
  }

  const buffer = await sharpInstance.toBuffer();
  const metadata = await sharp(buffer).metadata();

  return {
    buffer,
    format: options.format,
    width: metadata.width,
    height: metadata.height,
    size: buffer.length,
  };
}

/**
 * Process an uploaded image into multiple sizes
 */
export async function processImage(
  buffer: Buffer,
  options: {
    preferWebP?: boolean;
  } = {}
): Promise<ProcessingResult> {
  const startTime = Date.now();

  // Validate the image first
  await validateImageBuffer(buffer);

  // Get original metadata
  const originalMetadata = await sharp(buffer).metadata();
  const format = options.preferWebP ? "webp" : "jpeg";
  const quality = format === "webp" ? WEBP_QUALITY : JPEG_QUALITY;

  // Process original (with max dimension limit)
  const original = await processVariant(buffer, {
    width: originalMetadata.width > MAX_DIMENSION ? MAX_DIMENSION : undefined,
    height: originalMetadata.height > MAX_DIMENSION ? MAX_DIMENSION : undefined,
    fit: "inside",
    format,
    quality,
  });

  // Process medium size
  const medium = await processVariant(buffer, {
    width: MEDIUM_WIDTH,
    fit: "inside",
    format,
    quality,
  });

  // Process thumbnail (square crop)
  const thumbnail = await processVariant(buffer, {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    fit: "cover",
    format,
    quality: quality - 5, // Slightly lower quality for thumbnails
  });

  const processingTimeMs = Date.now() - startTime;

  logger.info(`Processed image in ${processingTimeMs}ms`, {
    originalSize: buffer.length,
    processedSize: original.size,
    format,
  });

  return {
    original,
    medium,
    thumbnail,
    metadata: {
      originalWidth: originalMetadata.width,
      originalHeight: originalMetadata.height,
      originalSize: buffer.length,
      originalFormat: originalMetadata.format,
      processingTimeMs,
    },
  };
}

/**
 * Generate a preview data URL for immediate display
 */
export async function generatePreviewDataUrl(buffer: Buffer): Promise<string> {
  const preview = await sharp(buffer)
    .resize(50, 50, { fit: "cover" })
    .jpeg({ quality: 50 })
    .toBuffer();

  return `data:image/jpeg;base64,${preview.toString("base64")}`;
}
