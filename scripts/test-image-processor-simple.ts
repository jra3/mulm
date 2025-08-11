#!/usr/bin/env ts-node

/**
 * Simple test for image processor
 * Run: npm run script scripts/test-image-processor-simple.ts
 */

import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';

// Import the actual image processor
import { processImage, validateImageBuffer, ImageValidationError } from '../src/utils/image-processor';

async function createTestImage(width: number, height: number, label: string): Promise<Buffer> {
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:rgb(74,144,226);stop-opacity:1" />
          <stop offset="100%" style="stop-color:rgb(126,87,194);stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#grad)"/>
      <text x="50%" y="45%" font-size="${Math.min(width, height) / 10}" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">
        ${label}
      </text>
      <text x="50%" y="55%" font-size="${Math.min(width, height) / 20}" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">
        ${width}x${height}
      </text>
    </svg>
  `;
  
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

async function runTests() {
  console.log('🧪 Testing Image Processor\n');
  console.log('=' .repeat(50));
  
  // Create test directory
  const testDir = path.join(process.cwd(), 'test-images');
  await fs.mkdir(testDir, { recursive: true });
  await fs.mkdir(path.join(testDir, 'processed'), { recursive: true });
  
  // Test 1: Valid image processing
  console.log('\n📸 Test 1: Processing valid image');
  console.log('-'.repeat(30));
  
  const validImage = await createTestImage(1200, 800, 'Fish Photo');
  await fs.writeFile(path.join(testDir, 'test-fish.jpg'), validImage);
  console.log(`✓ Created test image: ${validImage.length} bytes`);
  
  const result = await processImage(validImage);
  console.log(`✓ Processed successfully in ${result.metadata.processingTimeMs}ms`);
  console.log(`  • Original: ${result.original.width}x${result.original.height} (${result.original.size} bytes)`);
  console.log(`  • Medium: ${result.medium.width}x${result.medium.height} (${result.medium.size} bytes)`);
  console.log(`  • Thumbnail: ${result.thumbnail.width}x${result.thumbnail.height} (${result.thumbnail.size} bytes)`);
  
  // Save processed images
  await fs.writeFile(path.join(testDir, 'processed', 'original.jpg'), result.original.buffer);
  await fs.writeFile(path.join(testDir, 'processed', 'medium.jpg'), result.medium.buffer);
  await fs.writeFile(path.join(testDir, 'processed', 'thumbnail.jpg'), result.thumbnail.buffer);
  console.log(`✓ Saved processed images to ${path.join(testDir, 'processed')}`);
  
  // Test 2: Image validation
  console.log('\n🔍 Test 2: Image validation');
  console.log('-'.repeat(30));
  
  try {
    await validateImageBuffer(validImage);
    console.log('✓ Valid image passed validation');
  } catch (error) {
    console.log('✗ Valid image failed validation:', error.message);
  }
  
  // Test 3: Invalid image rejection
  console.log('\n🚫 Test 3: Invalid image rejection');
  console.log('-'.repeat(30));
  
  const invalidBuffer = Buffer.from('This is not an image');
  try {
    await validateImageBuffer(invalidBuffer);
    console.log('✗ Invalid buffer was incorrectly accepted');
  } catch (error) {
    if (error instanceof ImageValidationError) {
      console.log('✓ Invalid buffer correctly rejected:', error.message);
    } else {
      console.log('✗ Unexpected error:', error);
    }
  }
  
  // Test 4: Small image rejection
  console.log('\n📏 Test 4: Small image rejection');
  console.log('-'.repeat(30));
  
  const smallImage = await createTestImage(300, 300, 'Too Small');
  try {
    await validateImageBuffer(smallImage);
    console.log('✗ Small image was incorrectly accepted');
  } catch (error) {
    if (error instanceof ImageValidationError) {
      console.log('✓ Small image correctly rejected:', error.message);
    } else {
      console.log('✗ Unexpected error:', error);
    }
  }
  
  // Test 5: Large image handling
  console.log('\n🗻 Test 5: Large image handling');
  console.log('-'.repeat(30));
  
  const largeImage = await createTestImage(3000, 2000, 'Large Fish');
  const largeResult = await processImage(largeImage);
  console.log(`✓ Large image processed: ${largeResult.metadata.originalWidth}x${largeResult.metadata.originalHeight}`);
  console.log(`  • Resized to: ${largeResult.original.width}x${largeResult.original.height}`);
  
  // Test 6: WebP conversion
  console.log('\n🎨 Test 6: WebP conversion');
  console.log('-'.repeat(30));
  
  const webpResult = await processImage(validImage, { preferWebP: true });
  console.log(`✓ WebP conversion successful`);
  console.log(`  • Format: ${webpResult.original.format}`);
  console.log(`  • JPEG size: ${result.original.size} bytes`);
  console.log(`  • WebP size: ${webpResult.original.size} bytes`);
  console.log(`  • Savings: ${Math.round((1 - webpResult.original.size / result.original.size) * 100)}%`);
  
  await fs.writeFile(path.join(testDir, 'processed', 'original.webp'), webpResult.original.buffer);
  
  // Test 7: Different orientations
  console.log('\n🔄 Test 7: Different orientations');
  console.log('-'.repeat(30));
  
  const portrait = await createTestImage(600, 1200, 'Portrait');
  const portraitResult = await processImage(portrait);
  console.log(`✓ Portrait: ${portraitResult.medium.width}x${portraitResult.medium.height}`);
  
  const landscape = await createTestImage(1200, 600, 'Landscape');
  const landscapeResult = await processImage(landscape);
  console.log(`✓ Landscape: ${landscapeResult.medium.width}x${landscapeResult.medium.height}`);
  
  const square = await createTestImage(1000, 1000, 'Square');
  const squareResult = await processImage(square);
  console.log(`✓ Square: ${squareResult.medium.width}x${squareResult.medium.height}`);
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('✅ All tests completed successfully!');
  console.log(`📁 Test images saved in: ${testDir}`);
}

// Run the tests
runTests().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});