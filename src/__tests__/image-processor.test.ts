import { processImage, validateImageBuffer, ImageValidationError, generatePreviewDataUrl } from '../utils/image-processor';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';

describe('Image Processor', () => {
  // Create test images in memory
  const createTestImage = async (width: number, height: number, format: 'jpeg' | 'png' | 'webp' = 'jpeg') => {
    const buffer = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 255, g: 0, b: 0 }
      }
    })
    .toFormat(format)
    .toBuffer();
    
    return buffer;
  };

  const createInvalidBuffer = () => {
    // Create a buffer that's not an image
    return Buffer.from('This is not an image file');
  };

  describe('validateImageBuffer', () => {
    it('should accept valid JPEG images', async () => {
      const buffer = await createTestImage(800, 600, 'jpeg');
      await expect(validateImageBuffer(buffer)).resolves.not.toThrow();
    });

    it('should accept valid PNG images', async () => {
      const buffer = await createTestImage(800, 600, 'png');
      await expect(validateImageBuffer(buffer)).resolves.not.toThrow();
    });

    it('should accept valid WebP images', async () => {
      const buffer = await createTestImage(800, 600, 'webp');
      await expect(validateImageBuffer(buffer)).resolves.not.toThrow();
    });

    it('should reject non-image buffers', async () => {
      const buffer = createInvalidBuffer();
      await expect(validateImageBuffer(buffer)).rejects.toThrow(ImageValidationError);
    });

    it('should reject images that are too small', async () => {
      const buffer = await createTestImage(300, 300); // Below 400x400 minimum
      await expect(validateImageBuffer(buffer)).rejects.toThrow('Image too small');
    });

    it('should reject images that are too large', async () => {
      const buffer = await createTestImage(5000, 5000); // Above 4000x4000 maximum
      await expect(validateImageBuffer(buffer)).rejects.toThrow('Image too large');
    });
  });

  describe('processImage', () => {
    it('should process a valid image into three sizes', async () => {
      const buffer = await createTestImage(1200, 900);
      const result = await processImage(buffer);

      expect(result).toHaveProperty('original');
      expect(result).toHaveProperty('medium');
      expect(result).toHaveProperty('thumbnail');
      expect(result).toHaveProperty('metadata');

      // Check original is within max dimensions
      expect(result.original.width).toBeLessThanOrEqual(2048);
      expect(result.original.height).toBeLessThanOrEqual(2048);

      // Check medium size
      expect(result.medium.width).toBeLessThanOrEqual(800);

      // Check thumbnail is square
      expect(result.thumbnail.width).toBe(150);
      expect(result.thumbnail.height).toBe(150);

      // Check metadata
      expect(result.metadata.originalWidth).toBe(1200);
      expect(result.metadata.originalHeight).toBe(900);
      expect(result.metadata.processingTimeMs).toBeGreaterThan(0);
    });

    it('should not enlarge small images', async () => {
      const buffer = await createTestImage(600, 400);
      const result = await processImage(buffer);

      // Original should not be enlarged
      expect(result.original.width).toBe(600);
      expect(result.original.height).toBe(400);

      // Medium should not be enlarged beyond original
      expect(result.medium.width).toBe(600);
      expect(result.medium.height).toBe(400);
    });

    it('should handle portrait orientation correctly', async () => {
      const buffer = await createTestImage(600, 1200);
      const result = await processImage(buffer);

      // Check aspect ratio is preserved
      expect(result.medium.height).toBeGreaterThan(result.medium.width);
    });

    it('should handle landscape orientation correctly', async () => {
      const buffer = await createTestImage(1200, 600);
      const result = await processImage(buffer);

      // Check aspect ratio is preserved
      expect(result.medium.width).toBeGreaterThan(result.medium.height);
    });

    it('should strip EXIF data', async () => {
      // Create an image with EXIF data
      const buffer = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 255, g: 0, b: 0 }
        }
      })
      .withMetadata({
        exif: {
          IFD0: {
            Copyright: 'Test Copyright',
            Artist: 'Test Artist'
          }
        }
      })
      .jpeg()
      .toBuffer();

      const result = await processImage(buffer);
      
      // Check that EXIF data is removed
      const processedMetadata = await sharp(result.original.buffer).metadata();
      expect(processedMetadata.exif).toBeUndefined();
    });

    it('should produce WebP format when requested', async () => {
      const buffer = await createTestImage(800, 600);
      const result = await processImage(buffer, { preferWebP: true });

      expect(result.original.format).toBe('webp');
      expect(result.medium.format).toBe('webp');
      expect(result.thumbnail.format).toBe('webp');
    });

    it('should produce JPEG format by default', async () => {
      const buffer = await createTestImage(800, 600);
      const result = await processImage(buffer);

      expect(result.original.format).toBe('jpeg');
      expect(result.medium.format).toBe('jpeg');
      expect(result.thumbnail.format).toBe('jpeg');
    });

    it('should reject invalid images', async () => {
      const buffer = createInvalidBuffer();
      await expect(processImage(buffer)).rejects.toThrow(ImageValidationError);
    });
  });

  describe('generatePreviewDataUrl', () => {
    it('should generate a valid data URL', async () => {
      const buffer = await createTestImage(800, 600);
      const dataUrl = await generatePreviewDataUrl(buffer);

      expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/);
      
      // Check that it's a valid base64 string
      const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
      expect(() => Buffer.from(base64Data, 'base64')).not.toThrow();
    });

    it('should create a small preview', async () => {
      const buffer = await createTestImage(2000, 1500);
      const dataUrl = await generatePreviewDataUrl(buffer);
      
      // Decode and check dimensions
      const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
      const previewBuffer = Buffer.from(base64Data, 'base64');
      const metadata = await sharp(previewBuffer).metadata();
      
      expect(metadata.width).toBe(50);
      expect(metadata.height).toBe(50);
    });
  });

  describe('Performance', () => {
    it('should process images within reasonable time', async () => {
      const buffer = await createTestImage(2000, 1500);
      const startTime = Date.now();
      
      await processImage(buffer);
      
      const processingTime = Date.now() - startTime;
      // Should process within 5 seconds (generous for CI environments)
      expect(processingTime).toBeLessThan(5000);
    });
  });
});