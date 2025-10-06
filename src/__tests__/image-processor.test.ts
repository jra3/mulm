import { describe, test } from 'node:test';
import assert from 'node:assert';
import { processImage, validateImageBuffer, ImageValidationError, generatePreviewDataUrl } from '../utils/image-processor';
import sharp from 'sharp';

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
    test('should accept valid JPEG images', async () => {
      const buffer = await createTestImage(800, 600, 'jpeg');
      await assert.doesNotReject(async () => await validateImageBuffer(buffer));
    });

    test('should accept valid PNG images', async () => {
      const buffer = await createTestImage(800, 600, 'png');
      await assert.doesNotReject(async () => await validateImageBuffer(buffer));
    });

    test('should accept valid WebP images', async () => {
      const buffer = await createTestImage(800, 600, 'webp');
      await assert.doesNotReject(async () => await validateImageBuffer(buffer));
    });

    test('should reject non-image buffers', async () => {
      const buffer = createInvalidBuffer();
      await assert.rejects(async () => await validateImageBuffer(buffer), ImageValidationError);
    });

    test('should reject images that are too small', async () => {
      const buffer = await createTestImage(300, 300); // Below 400x400 minimum
      await assert.rejects(async () => await validateImageBuffer(buffer), /Image too small/);
    });

    test('should reject images that are too large', async () => {
      const buffer = await createTestImage(5000, 5000); // Above 4000x4000 maximum
      await assert.rejects(async () => await validateImageBuffer(buffer), /Image too large/);
    });
  });

  describe('processImage', () => {
    test('should process a valid image into three sizes', async () => {
      const buffer = await createTestImage(1200, 900);
      const result = await processImage(buffer);

      assert.ok(result.original !== undefined);
      assert.ok(result.medium !== undefined);
      assert.ok(result.thumbnail !== undefined);
      assert.ok(result.metadata !== undefined);

      // Check original is within max dimensions
      assert.ok(result.original.width <= 2048);
      assert.ok(result.original.height <= 2048);

      // Check medium size
      assert.ok(result.medium.width <= 800);

      // Check thumbnail is square
      assert.strictEqual(result.thumbnail.width, 150);
      assert.strictEqual(result.thumbnail.height, 150);

      // Check metadata
      assert.strictEqual(result.metadata.originalWidth, 1200);
      assert.strictEqual(result.metadata.originalHeight, 900);
      assert.ok(result.metadata.processingTimeMs > 0);
    });

    test('should not enlarge small images', async () => {
      const buffer = await createTestImage(600, 400);
      const result = await processImage(buffer);

      // Original should not be enlarged
      assert.strictEqual(result.original.width, 600);
      assert.strictEqual(result.original.height, 400);

      // Medium should not be enlarged beyond original
      assert.strictEqual(result.medium.width, 600);
      assert.strictEqual(result.medium.height, 400);
    });

    test('should handle portrait orientation correctly', async () => {
      const buffer = await createTestImage(600, 1200);
      const result = await processImage(buffer);

      // Check aspect ratio is preserved
      assert.ok(result.medium.height > result.medium.width);
    });

    test('should handle landscape orientation correctly', async () => {
      const buffer = await createTestImage(1200, 600);
      const result = await processImage(buffer);

      // Check aspect ratio is preserved
      assert.ok(result.medium.width > result.medium.height);
    });

    test('should strip EXIF data', async () => {
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
      assert.strictEqual(processedMetadata.exif, undefined);
    });

    test('should produce WebP format when requested', async () => {
      const buffer = await createTestImage(800, 600);
      const result = await processImage(buffer, { preferWebP: true });

      assert.strictEqual(result.original.format, 'webp');
      assert.strictEqual(result.medium.format, 'webp');
      assert.strictEqual(result.thumbnail.format, 'webp');
    });

    test('should produce JPEG format by default', async () => {
      const buffer = await createTestImage(800, 600);
      const result = await processImage(buffer);

      assert.strictEqual(result.original.format, 'jpeg');
      assert.strictEqual(result.medium.format, 'jpeg');
      assert.strictEqual(result.thumbnail.format, 'jpeg');
    });

    test('should reject invalid images', async () => {
      const buffer = createInvalidBuffer();
      await assert.rejects(async () => await processImage(buffer), ImageValidationError);
    });
  });

  describe('generatePreviewDataUrl', () => {
    test('should generate a valid data URL', async () => {
      const buffer = await createTestImage(800, 600);
      const dataUrl = await generatePreviewDataUrl(buffer);

      assert.match(dataUrl, /^data:image\/jpeg;base64,/);
      
      // Check that it's a valid base64 string
      const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
      assert.doesNotThrow(() => Buffer.from(base64Data, 'base64'));
    });

    test('should create a small preview', async () => {
      const buffer = await createTestImage(2000, 1500);
      const dataUrl = await generatePreviewDataUrl(buffer);
      
      // Decode and check dimensions
      const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
      const previewBuffer = Buffer.from(base64Data, 'base64');
      const metadata = await sharp(previewBuffer).metadata();
      
      assert.strictEqual(metadata.width, 50);
      assert.strictEqual(metadata.height, 50);
    });
  });

  describe('Performance', () => {
    test('should process images within reasonable time', async () => {
      const buffer = await createTestImage(2000, 1500);
      const startTime = Date.now();
      
      await processImage(buffer);
      
      const processingTime = Date.now() - startTime;
      // Should process within 5 seconds (generous for CI environments)
      assert.ok(processingTime < 5000);
    });
  });
});