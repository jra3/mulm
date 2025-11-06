#!/usr/bin/env tsx
/**
 * Stress test for image upload functionality
 * Tests the new 20MB/no-dimension-limit upload policy
 *
 * Usage:
 *   npm run script scripts/stress-test-uploads.ts
 */

import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import os from "os";

interface TestResult {
  name: string;
  width: number;
  height: number;
  fileSizeMB: number;
  processingTimeMs: number;
  peakMemoryMB: number;
  success: boolean;
  error?: string;
}

const results: TestResult[] = [];

/**
 * Create a test image with specific dimensions
 */
async function createTestImage(
  width: number,
  height: number,
  name: string
): Promise<{ buffer: Buffer; fileSizeMB: number }> {
  console.log(`Creating test image: ${name} (${width}x${height})...`);

  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 128, b: 64 },
    },
  })
    .jpeg({ quality: 95 }) // High quality to maximize file size
    .toBuffer();

  const fileSizeMB = buffer.length / (1024 * 1024);
  console.log(`  Created: ${fileSizeMB.toFixed(2)}MB`);

  return { buffer, fileSizeMB };
}

/**
 * Test image processing with memory monitoring
 */
async function testImageProcessing(
  buffer: Buffer,
  testName: string,
  width: number,
  height: number,
  fileSizeMB: number
): Promise<TestResult> {
  console.log(`\nTesting: ${testName}`);

  const startMemory = process.memoryUsage().heapUsed / (1024 * 1024);
  const startTime = Date.now();

  try {
    // Import the image processor
    const { processImage } = await import("../src/utils/image-processor");

    // Process the image
    await processImage(buffer);

    const endTime = Date.now();
    const endMemory = process.memoryUsage().heapUsed / (1024 * 1024);
    const processingTimeMs = endTime - startTime;
    const peakMemoryMB = endMemory - startMemory;

    console.log(`  ✅ Success!`);
    console.log(`  Processing time: ${processingTimeMs}ms`);
    console.log(`  Memory used: ${peakMemoryMB.toFixed(2)}MB`);

    return {
      name: testName,
      width,
      height,
      fileSizeMB,
      processingTimeMs,
      peakMemoryMB,
      success: true,
    };
  } catch (error) {
    console.log(`  ❌ Failed: ${error instanceof Error ? error.message : String(error)}`);

    return {
      name: testName,
      width,
      height,
      fileSizeMB,
      processingTimeMs: Date.now() - startTime,
      peakMemoryMB: 0,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Test concurrent uploads
 */
async function testConcurrentUploads(count: number): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${count} concurrent uploads...`);
  console.log('='.repeat(60));

  const testImages = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      createTestImage(2000, 1500, `concurrent-${i + 1}`)
    )
  );

  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed / (1024 * 1024);

  const uploadPromises = testImages.map((img, i) =>
    testImageProcessing(img.buffer, `Concurrent Upload ${i + 1}`, 2000, 1500, img.fileSizeMB)
  );

  const concurrentResults = await Promise.all(uploadPromises);

  const endTime = Date.now();
  const endMemory = process.memoryUsage().heapUsed / (1024 * 1024);

  const totalTime = endTime - startTime;
  const totalMemory = endMemory - startMemory;
  const successCount = concurrentResults.filter(r => r.success).length;

  console.log(`\nConcurrent Upload Summary:`);
  console.log(`  Total time: ${totalTime}ms`);
  console.log(`  Total memory: ${totalMemory.toFixed(2)}MB`);
  console.log(`  Success rate: ${successCount}/${count}`);

  results.push(...concurrentResults);
}

/**
 * Main stress test runner
 */
async function runStressTests() {
  console.log('='.repeat(60));
  console.log('IMAGE UPLOAD STRESS TEST');
  console.log('='.repeat(60));
  console.log(`Node version: ${process.version}`);
  console.log(`Platform: ${os.platform()}`);
  console.log(`Total memory: ${(os.totalmem() / (1024 ** 3)).toFixed(2)}GB`);
  console.log(`Free memory: ${(os.freemem() / (1024 ** 3)).toFixed(2)}GB`);
  console.log('='.repeat(60));

  // Test 1: Standard iPhone photos (4032x3024, ~12MP)
  console.log(`\n${'='.repeat(60)}`);
  console.log('Test 1: Standard iPhone Photo (4032x3024)');
  console.log('='.repeat(60));
  const iphone12MP = await createTestImage(4032, 3024, "iPhone-12MP");
  results.push(
    await testImageProcessing(iphone12MP.buffer, "iPhone 12MP (4032x3024)", 4032, 3024, iphone12MP.fileSizeMB)
  );

  // Test 2: iPhone Pro 48MP (8064x6048)
  console.log(`\n${'='.repeat(60)}`);
  console.log('Test 2: iPhone Pro 48MP Photo (8064x6048)');
  console.log('='.repeat(60));
  const iphone48MP = await createTestImage(8064, 6048, "iPhone-48MP");
  results.push(
    await testImageProcessing(iphone48MP.buffer, "iPhone Pro 48MP (8064x6048)", 8064, 6048, iphone48MP.fileSizeMB)
  );

  // Test 3: Extreme resolution (10000x10000)
  console.log(`\n${'='.repeat(60)}`);
  console.log('Test 3: Extreme Resolution (10000x10000)');
  console.log('='.repeat(60));
  const extreme = await createTestImage(10000, 10000, "Extreme-100MP");
  results.push(
    await testImageProcessing(extreme.buffer, "Extreme 100MP (10000x10000)", 10000, 10000, extreme.fileSizeMB)
  );

  // Test 4: Very wide panorama (12000x2000)
  console.log(`\n${'='.repeat(60)}`);
  console.log('Test 4: Wide Panorama (12000x2000)');
  console.log('='.repeat(60));
  const panorama = await createTestImage(12000, 2000, "Panorama");
  results.push(
    await testImageProcessing(panorama.buffer, "Panorama (12000x2000)", 12000, 2000, panorama.fileSizeMB)
  );

  // Test 5: Multiple sizes
  console.log(`\n${'='.repeat(60)}`);
  console.log('Test 5: Various Sizes');
  console.log('='.repeat(60));
  const sizes = [
    { w: 2000, h: 1500, name: "Small (2000x1500)" },
    { w: 4000, h: 3000, name: "Medium (4000x3000)" },
    { w: 6000, h: 4500, name: "Large (6000x4500)" },
  ];

  for (const size of sizes) {
    const img = await createTestImage(size.w, size.h, size.name);
    results.push(
      await testImageProcessing(img.buffer, size.name, size.w, size.h, img.fileSizeMB)
    );
  }

  // Test 6: Concurrent uploads (simulating 5 users uploading at once)
  await testConcurrentUploads(5);

  // Test 7: Sequential uploads (simulating rapid succession)
  console.log(`\n${'='.repeat(60)}`);
  console.log('Test 7: Rapid Sequential Uploads (10 images)');
  console.log('='.repeat(60));
  for (let i = 0; i < 10; i++) {
    const img = await createTestImage(3000, 2000, `Sequential-${i + 1}`);
    results.push(
      await testImageProcessing(img.buffer, `Sequential ${i + 1}`, 3000, 2000, img.fileSizeMB)
    );
  }

  // Print summary
  printSummary();
}

/**
 * Print test summary
 */
function printSummary() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('STRESS TEST SUMMARY');
  console.log('='.repeat(60));

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`\nTotal tests: ${results.length}`);
  console.log(`✅ Passed: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);

  if (successful.length > 0) {
    console.log(`\nPerformance Metrics (Successful Tests):`);

    const avgProcessingTime = successful.reduce((sum, r) => sum + r.processingTimeMs, 0) / successful.length;
    const maxProcessingTime = Math.max(...successful.map(r => r.processingTimeMs));
    const minProcessingTime = Math.min(...successful.map(r => r.processingTimeMs));

    const avgMemory = successful.reduce((sum, r) => sum + r.peakMemoryMB, 0) / successful.length;
    const maxMemory = Math.max(...successful.map(r => r.peakMemoryMB));

    const avgFileSize = successful.reduce((sum, r) => sum + r.fileSizeMB, 0) / successful.length;
    const maxFileSize = Math.max(...successful.map(r => r.fileSizeMB));

    console.log(`  Processing Time:`);
    console.log(`    Average: ${avgProcessingTime.toFixed(0)}ms`);
    console.log(`    Min: ${minProcessingTime.toFixed(0)}ms`);
    console.log(`    Max: ${maxProcessingTime.toFixed(0)}ms`);

    console.log(`  Memory Usage:`);
    console.log(`    Average: ${avgMemory.toFixed(2)}MB`);
    console.log(`    Peak: ${maxMemory.toFixed(2)}MB`);

    console.log(`  File Sizes:`);
    console.log(`    Average: ${avgFileSize.toFixed(2)}MB`);
    console.log(`    Largest: ${maxFileSize.toFixed(2)}MB`);
  }

  if (failed.length > 0) {
    console.log(`\n❌ Failed Tests:`);
    failed.forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  }

  // Check for concerning metrics
  console.log(`\n${'='.repeat(60)}`);
  console.log('HEALTH CHECKS');
  console.log('='.repeat(60));

  const slowTests = successful.filter(r => r.processingTimeMs > 10000);
  const memoryHeavy = successful.filter(r => r.peakMemoryMB > 500);

  if (slowTests.length > 0) {
    console.log(`\n⚠️  Slow processing detected (>10s):`);
    slowTests.forEach(r => {
      console.log(`  - ${r.name}: ${r.processingTimeMs}ms`);
    });
  }

  if (memoryHeavy.length > 0) {
    console.log(`\n⚠️  High memory usage detected (>500MB):`);
    memoryHeavy.forEach(r => {
      console.log(`  - ${r.name}: ${r.peakMemoryMB.toFixed(2)}MB`);
    });
  }

  if (slowTests.length === 0 && memoryHeavy.length === 0 && failed.length === 0) {
    console.log(`\n✅ All health checks passed!`);
    console.log(`   - No slow processing detected`);
    console.log(`   - Memory usage within acceptable limits`);
    console.log(`   - No failures`);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Final memory usage: ${(process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2)}MB`);
  console.log('='.repeat(60));
}

// Run the tests
runStressTests().catch(error => {
  console.error('Fatal error during stress test:', error);
  process.exit(1);
});
