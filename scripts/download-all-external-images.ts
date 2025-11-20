/**
 * Download All External Images to R2
 *
 * Batch processes existing external image URLs in the database:
 * - Downloads from external sources (Wikipedia, GBIF, FishBase)
 * - Transcodes to optimized JPEG (800x600, 85% quality)
 * - Uploads to Cloudflare R2
 * - Updates database URLs to R2 locations
 * - Populates metadata (source, attribution, license, original_url)
 *
 * Features:
 * - Batch processing with resumable progress
 * - Avoids re-downloading (checks R2 first via MD5 hash)
 * - Graceful error handling (continues on failures)
 * - Comprehensive logging
 * - Dry-run mode
 *
 * Usage:
 *   npm run script scripts/download-all-external-images.ts                    # Dry-run
 *   npm run script scripts/download-all-external-images.ts -- --execute       # Execute
 *   npm run script scripts/download-all-external-images.ts -- --batch-size=100  # Process 100 at a time
 *   npm run script scripts/download-all-external-images.ts -- --species-id=61  # Single species
 *   npm run script scripts/download-all-external-images.ts -- --force         # Re-download even if in R2
 *
 * Recommended for production:
 *   npm run script scripts/download-all-external-images.ts -- --execute --batch-size=200
 */

import sqlite3 from "sqlite3";
import { open, type Database } from "sqlite";
import { join } from "path";
import { createHash } from "crypto";
import sharp from "sharp";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import config from "../src/config.json";

// Image processing configuration
const IMAGE_CONFIG = {
  maxWidth: 800,
  maxHeight: 600,
  quality: 85,
};

// Initialize R2/S3 client
const s3Client = new S3Client({
  region: "auto",
  endpoint: config.storage.s3Url,
  credentials: {
    accessKeyId: config.storage.s3AccessKeyId,
    secretAccessKey: config.storage.s3Secret,
  },
});

/**
 * Metadata for a species image
 */
interface SpeciesImageMetadata {
  source: string;
  attribution?: string;
  license?: string;
}

/**
 * Result of downloading an image
 */
interface ImageDownloadResult {
  success: boolean;
  r2Url?: string;
  r2Key?: string;
  originalUrl: string;
  metadata: SpeciesImageMetadata;
  error?: string;
  skipped?: boolean;
}

/**
 * Generate MD5 hash from URL
 */
function getImageHash(url: string): string {
  return createHash("md5").update(url).digest("hex");
}

/**
 * Generate R2 key
 */
function getR2Key(groupId: number, imageHash: string, ext = "jpg"): string {
  return `species-images/${groupId}/${imageHash}.${ext}`;
}

/**
 * Get R2 public URL
 */
function getR2Url(key: string): string {
  return `${config.storage.r2PublicUrl}/${key}`;
}

/**
 * Detect source from URL
 */
function detectSource(url: string): string {
  if (url.includes("fishbase.se") || url.includes("fishbase.org")) return "fishbase";
  if (url.includes("wikipedia.org") || url.includes("wikimedia.org")) return "wikipedia";
  if (url.includes("gbif.org") || url.includes("zenodo.org")) return "gbif";
  return "external";
}

/**
 * Get default metadata for source
 */
function getDefaultMetadata(source: string): Partial<SpeciesImageMetadata> {
  switch (source) {
    case "fishbase":
      return { attribution: "FishBase.org", license: "CC BY-NC" };
    case "wikipedia":
      return { attribution: "Wikipedia/Wikimedia Commons", license: "Various CC licenses" };
    case "gbif":
      return { attribution: "GBIF", license: "Various (see source)" };
    default:
      return {};
  }
}

/**
 * Check if image exists in R2
 */
async function checkR2Exists(r2Key: string): Promise<boolean> {
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: config.storage.s3Bucket,
        Key: r2Key,
      })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Download image from URL
 */
async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; BAS-BAP-Bot/1.0)",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Transcode image to optimized JPEG
 */
async function transcodeImage(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer)
    .resize(IMAGE_CONFIG.maxWidth, IMAGE_CONFIG.maxHeight, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({
      quality: IMAGE_CONFIG.quality,
      progressive: true,
    })
    .toBuffer();
}

/**
 * Upload to R2
 */
async function uploadToR2(key: string, buffer: Buffer): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.storage.s3Bucket,
      Key: key,
      Body: buffer,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000",
    })
  );
}

/**
 * Download, transcode, and upload image to R2
 */
async function downloadAndStoreImage(
  groupId: number,
  externalUrl: string,
  force: boolean
): Promise<ImageDownloadResult> {
  try {
    const source = detectSource(externalUrl);
    const defaultMeta = getDefaultMetadata(source);

    const metadata: SpeciesImageMetadata = {
      source,
      attribution: defaultMeta.attribution,
      license: defaultMeta.license,
    };

    const imageHash = getImageHash(externalUrl);
    const r2Key = getR2Key(groupId, imageHash);

    // Check if already in R2
    if (!force) {
      const exists = await checkR2Exists(r2Key);
      if (exists) {
        return {
          success: true,
          r2Url: getR2Url(r2Key),
          r2Key,
          originalUrl: externalUrl,
          metadata,
          skipped: true,
        };
      }
    }

    // Download, transcode, upload
    const imageBuffer = await downloadImage(externalUrl);
    const optimizedBuffer = await transcodeImage(imageBuffer);
    await uploadToR2(r2Key, optimizedBuffer);

    return {
      success: true,
      r2Url: getR2Url(r2Key),
      r2Key,
      originalUrl: externalUrl,
      metadata,
      skipped: false,
    };
  } catch (error: any) {
    const source = detectSource(externalUrl);
    const defaultMeta = getDefaultMetadata(source);

    return {
      success: false,
      originalUrl: externalUrl,
      metadata: {
        source,
        attribution: defaultMeta.attribution,
        license: defaultMeta.license,
      },
      error: error.message,
    };
  }
}

interface ExternalImage {
  id: number;
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
  image_url: string;
  display_order: number;
  source: string | null;
  original_url: string | null;
}

interface ProcessResult {
  id: number;
  group_id: number;
  scientific_name: string;
  original_url: string;
  r2_url: string | null;
  status: "success" | "skipped" | "error";
  error_message?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const force = args.includes("--force");
  const batchSizeArg = args.find((arg) => arg.startsWith("--batch-size="));
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.split("=")[1]) : undefined;
  const speciesIdArg = args.find((arg) => arg.startsWith("--species-id="));
  const speciesId = speciesIdArg ? parseInt(speciesIdArg.split("=")[1]) : undefined;
  const startAfterArg = args.find((arg) => arg.startsWith("--start-after="));
  const startAfterId = startAfterArg ? parseInt(startAfterArg.split("=")[1]) : undefined;
  const dbArg = args.find((arg) => arg.startsWith("--db="));
  const customDbPath = dbArg ? dbArg.split("=")[1] : null;

  console.log("\n=== Download All External Images to R2 ===\n");
  console.log(
    `Mode: ${execute ? "🔴 EXECUTE (will modify database)" : "🟡 DRY-RUN (preview only)"}`
  );
  console.log(`Force re-download: ${force}`);
  if (batchSize) {
    console.log(`Batch size: ${batchSize} images per run`);
  }
  if (speciesId) {
    console.log(`Single species: ID ${speciesId}`);
  }
  if (startAfterId) {
    console.log(`Starting after image ID: ${startAfterId}`);
  }
  console.log("");

  // Connect to database
  const dbPath = customDbPath || process.env.DB_PATH || join(__dirname, "../db/database.db");
  console.log(`Database: ${dbPath}\n`);
  const sqlite = await open({
    filename: dbPath,
    driver: sqlite3.Database,
    mode: execute ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY,
  });

  // Query external images
  let query: string;
  let params: any[] = [];

  if (speciesId) {
    // Single species
    query = `
      SELECT
        si.id,
        si.group_id,
        sng.canonical_genus,
        sng.canonical_species_name,
        si.image_url,
        si.display_order,
        si.source,
        si.original_url
      FROM species_images si
      INNER JOIN species_name_group sng ON si.group_id = sng.group_id
      WHERE si.group_id = ?
        AND si.image_url NOT LIKE '%r2.dev%'
      ORDER BY si.id
    `;
    params = [speciesId];
  } else {
    // All external images
    query = `
      SELECT
        si.id,
        si.group_id,
        sng.canonical_genus,
        sng.canonical_species_name,
        si.image_url,
        si.display_order,
        si.source,
        si.original_url
      FROM species_images si
      INNER JOIN species_name_group sng ON si.group_id = sng.group_id
      WHERE si.image_url NOT LIKE '%r2.dev%'
        ${startAfterId ? "AND si.id > ?" : ""}
      ORDER BY si.id
      ${batchSize ? `LIMIT ${batchSize}` : ""}
    `;

    if (startAfterId) params.push(startAfterId);
  }

  const externalImages = await sqlite.all<ExternalImage[]>(query, params);

  console.log(`Found ${externalImages.length} external images to process\n`);

  if (externalImages.length === 0) {
    console.log("No external images found. All images are already in R2!");
    await sqlite.close();
    return;
  }

  // Show total context
  const totalExternal = await sqlite.get<{ count: number }>(
    "SELECT COUNT(*) as count FROM species_images WHERE image_url NOT LIKE '%r2.dev%'"
  );
  console.log(`Total external images in database: ${totalExternal?.count || 0}`);
  console.log(
    `Processing: ${externalImages.length} (${((externalImages.length / (totalExternal?.count || 1)) * 100).toFixed(1)}%)\n`
  );

  // Group by species for reporting
  const speciesGroups = new Map<number, string>();
  externalImages.forEach((img) => {
    if (!speciesGroups.has(img.group_id)) {
      speciesGroups.set(
        img.group_id,
        `${img.canonical_genus} ${img.canonical_species_name}`
      );
    }
  });
  console.log(`Species represented: ${speciesGroups.size}`);
  console.log("");

  // Process images
  const results: ProcessResult[] = [];
  let processed = 0;
  const startTime = Date.now();

  for (const img of externalImages) {
    processed++;
    const scientificName = `${img.canonical_genus} ${img.canonical_species_name}`;

    process.stdout.write(
      `[${processed}/${externalImages.length}] ${img.id}: ${scientificName}...`
    );

    if (!execute) {
      console.log(" (dry-run)");
      continue;
    }

    try {
      // Download, transcode, and upload to R2
      const result = await downloadAndStoreImage(img.group_id, img.image_url, force);

      if (result.success && result.r2Url) {
        // Update database with R2 URL and metadata
        await sqlite.run(
          `UPDATE species_images
           SET image_url = ?,
               original_url = ?,
               source = ?,
               attribution = ?,
               license = ?
           WHERE id = ?`,
          [
            result.r2Url,
            result.originalUrl,
            result.metadata.source,
            result.metadata.attribution || null,
            result.metadata.license || null,
            img.id,
          ]
        );

        console.log(
          ` ✅ ${result.skipped ? "Skipped (already in R2)" : "Downloaded & uploaded"}`
        );

        results.push({
          id: img.id,
          group_id: img.group_id,
          scientific_name: scientificName,
          original_url: img.image_url,
          r2_url: result.r2Url,
          status: result.skipped ? "skipped" : "success",
        });
      } else {
        console.log(` ❌ Failed: ${result.error}`);

        results.push({
          id: img.id,
          group_id: img.group_id,
          scientific_name: scientificName,
          original_url: img.image_url,
          r2_url: null,
          status: "error",
          error_message: result.error,
        });
      }
    } catch (error: any) {
      console.log(` ⚠️  Error: ${error.message}`);

      results.push({
        id: img.id,
        group_id: img.group_id,
        scientific_name: scientificName,
        original_url: img.image_url,
        r2_url: null,
        status: "error",
        error_message: error.message,
      });
    }

    // Delay between downloads (be respectful to external servers)
    await sleep(200);

    // Progress update every 25 images
    if (processed % 25 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      const rate = (processed / (Date.now() - startTime)) * 1000 * 60;
      const remaining = Math.ceil((externalImages.length - processed) / rate);
      console.log(
        `  📊 Progress: ${processed}/${externalImages.length} (${elapsed} min elapsed, ~${remaining} min remaining)`
      );
    }
  }

  // Summary
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log("\n=== Summary ===\n");

  const successCount = results.filter((r) => r.status === "success").length;
  const skippedCount = results.filter((r) => r.status === "skipped").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  console.log(`Total processed: ${externalImages.length}`);
  console.log(`  ✅ Downloaded: ${successCount}`);
  console.log(`  ⏭️  Skipped (already in R2): ${skippedCount}`);
  console.log(`  ❌ Errors: ${errorCount}`);
  console.log(`Time elapsed: ${totalTime} minutes`);
  console.log("");

  // Show errors if any
  if (errorCount > 0) {
    console.log("\nFailed downloads (first 10):");
    results
      .filter((r) => r.status === "error")
      .slice(0, 10)
      .forEach((r) => {
        console.log(`  - ${r.scientific_name}: ${r.error_message}`);
      });

    if (errorCount > 10) {
      console.log(`  ... and ${errorCount - 10} more`);
    }
  }

  // Show last ID for resume
  if (externalImages.length > 0) {
    const lastId = externalImages[externalImages.length - 1].id;
    console.log(`\nLast image ID processed: ${lastId}`);
    console.log(`To resume from next batch: --start-after=${lastId}\n`);
  }

  console.log(
    `${execute ? "✅ Download completed!" : "🟡 Dry-run completed. Use --execute to download."}\n`
  );

  await sqlite.close();
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
