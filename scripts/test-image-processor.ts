#!/usr/bin/env ts-node

/**
 * Manual test script for image processor
 * Usage: npm run script scripts/test-image-processor.ts [path-to-image]
 */

import {
  processImage,
  validateImageBuffer,
  generatePreviewDataUrl,
} from "../src/utils/image-processor";
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";

async function createTestImage(outputPath: string) {
  console.log("Creating test image...");

  // Create a test image with text
  const svg = `
    <svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg">
      <rect width="1200" height="800" fill="#4a90e2"/>
      <text x="50%" y="50%" font-size="60" fill="white" text-anchor="middle" dominant-baseline="middle">
        Test Image 1200x800
      </text>
      <text x="50%" y="60%" font-size="30" fill="white" text-anchor="middle" dominant-baseline="middle">
        Created at ${new Date().toISOString()}
      </text>
    </svg>
  `;

  const buffer = await sharp(Buffer.from(svg)).jpeg().toBuffer();

  await fs.writeFile(outputPath, buffer);
  console.log(`Test image created at: ${outputPath}`);
  return outputPath;
}

async function testImageProcessing(imagePath: string) {
  console.log(`\n=== Testing image: ${imagePath} ===\n`);

  try {
    // Read the image
    const buffer = await fs.readFile(imagePath);
    console.log(`✓ Read image (${buffer.length} bytes)`);

    // Get original metadata
    const originalMetadata = await sharp(buffer).metadata();
    console.log(
      `✓ Original: ${originalMetadata.width}x${originalMetadata.height}, format: ${originalMetadata.format}`
    );

    // Validate the image
    console.log("\n--- Validation ---");
    try {
      await validateImageBuffer(buffer);
      console.log("✓ Image validation passed");
    } catch (error) {
      console.log(`✗ Validation failed: ${error.message}`);
      return;
    }

    // Process the image
    console.log("\n--- Processing ---");
    const startTime = Date.now();
    const result = await processImage(buffer, { preferWebP: false });
    const processingTime = Date.now() - startTime;

    console.log(`✓ Processing completed in ${processingTime}ms`);
    console.log(
      `  Original: ${result.original.width}x${result.original.height}, ${result.original.size} bytes`
    );
    console.log(
      `  Medium: ${result.medium.width}x${result.medium.height}, ${result.medium.size} bytes`
    );
    console.log(
      `  Thumbnail: ${result.thumbnail.width}x${result.thumbnail.height}, ${result.thumbnail.size} bytes`
    );

    // Calculate compression ratios
    const originalSize = buffer.length;
    const compressionRatio = (((originalSize - result.original.size) / originalSize) * 100).toFixed(
      1
    );
    console.log(`\n--- Compression ---`);
    console.log(`  Original file: ${originalSize} bytes`);
    console.log(
      `  Processed original: ${result.original.size} bytes (${compressionRatio}% reduction)`
    );

    // Save processed images
    const outputDir = path.join(path.dirname(imagePath), "processed");
    await fs.mkdir(outputDir, { recursive: true });

    const baseName = path.basename(imagePath, path.extname(imagePath));
    await fs.writeFile(path.join(outputDir, `${baseName}-original.jpg`), result.original.buffer);
    await fs.writeFile(path.join(outputDir, `${baseName}-medium.jpg`), result.medium.buffer);
    await fs.writeFile(path.join(outputDir, `${baseName}-thumb.jpg`), result.thumbnail.buffer);

    console.log(`\n✓ Saved processed images to: ${outputDir}`);

    // Test preview generation
    console.log("\n--- Preview Generation ---");
    const previewDataUrl = await generatePreviewDataUrl(buffer);
    console.log(`✓ Generated preview data URL (${previewDataUrl.length} characters)`);

    // Test WebP processing
    console.log("\n--- WebP Processing ---");
    const webpResult = await processImage(buffer, { preferWebP: true });
    console.log(`✓ WebP processing completed`);
    console.log(`  Original: ${webpResult.original.size} bytes (WebP)`);
    console.log(
      `  JPEG vs WebP size: ${result.original.size} vs ${webpResult.original.size} bytes`
    );

    await fs.writeFile(
      path.join(outputDir, `${baseName}-original.webp`),
      webpResult.original.buffer
    );
  } catch (error) {
    console.error("\n✗ Error:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

async function testMultipleImages() {
  const testDir = path.join(process.cwd(), "test-images");
  await fs.mkdir(testDir, { recursive: true });

  console.log("=== Creating test images of various sizes ===\n");

  // Create test images of different sizes
  const testCases = [
    { width: 800, height: 600, name: "landscape-small" },
    { width: 1920, height: 1080, name: "landscape-hd" },
    { width: 3000, height: 2000, name: "landscape-large" },
    { width: 600, height: 800, name: "portrait-small" },
    { width: 1080, height: 1920, name: "portrait-hd" },
    { width: 500, height: 500, name: "square-small" },
    { width: 2000, height: 2000, name: "square-large" },
  ];

  for (const testCase of testCases) {
    const svg = `
      <svg width="${testCase.width}" height="${testCase.height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:rgb(74,144,226);stop-opacity:1" />
            <stop offset="100%" style="stop-color:rgb(126,87,194);stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="${testCase.width}" height="${testCase.height}" fill="url(#grad)"/>
        <text x="50%" y="50%" font-size="${Math.min(testCase.width, testCase.height) / 10}" fill="white" text-anchor="middle" dominant-baseline="middle">
          ${testCase.name}
        </text>
        <text x="50%" y="60%" font-size="${Math.min(testCase.width, testCase.height) / 20}" fill="white" text-anchor="middle" dominant-baseline="middle">
          ${testCase.width}x${testCase.height}
        </text>
      </svg>
    `;

    const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
    const imagePath = path.join(testDir, `${testCase.name}.jpg`);
    await fs.writeFile(imagePath, buffer);

    await testImageProcessing(imagePath);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    // Test with provided image
    const imagePath = path.resolve(args[0]);
    try {
      await fs.access(imagePath);
      await testImageProcessing(imagePath);
    } catch (error) {
      console.error(`Error: Could not access file ${imagePath}`);
      process.exit(1);
    }
  } else {
    // Run automated tests with generated images
    console.log("No image path provided. Running automated tests with generated images.\n");
    await testMultipleImages();
  }

  console.log("\n=== All tests completed ===");
}

main().catch(console.error);
