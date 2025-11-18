/**
 * Download species images from external sources and upload to R2
 *
 * Creates optimized thumbnails and stores them in Cloudflare R2 bucket
 * Updates species_images table with R2 URLs
 *
 * Usage:
 *   npm run script scripts/download-and-upload-species-images.ts -- --species-id=61
 *   npm run script scripts/download-and-upload-species-images.ts -- --all
 *   npm run script scripts/download-and-upload-species-images.ts -- --dry-run
 */

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { join } from 'path';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import config from '../src/config.json';

const THUMBNAIL_WIDTH = 800;
const THUMBNAIL_HEIGHT = 600;
const THUMBNAIL_QUALITY = 85;

interface ImageToProcess {
  id: number;
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
  image_url: string;
  display_order: number;
}

// Initialize R2/S3 client
const s3Client = new S3Client({
  region: 'auto',
  endpoint: config.storage.s3Url,
  credentials: {
    accessKeyId: config.storage.s3AccessKeyId,
    secretAccessKey: config.storage.s3Secret,
  },
});

function getImageHash(url: string): string {
  return createHash('md5').update(url).digest('hex');
}

function getR2Key(groupId: number, imageHash: string, ext: string = 'jpg'): string {
  return `species-images/${groupId}/${imageHash}.${ext}`;
}

function getR2Url(key: string): string {
  return `${config.storage.r2PublicUrl}/${key}`;
}

async function downloadImage(url: string): Promise<Buffer> {
  console.log(`  Downloading: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BAS-BAP-Bot/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    throw new Error(`Failed to download: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function createThumbnail(imageBuffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(imageBuffer)
      .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: THUMBNAIL_QUALITY, progressive: true })
      .toBuffer();
  } catch (error) {
    throw new Error(`Failed to create thumbnail: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function uploadToR2(key: string, buffer: Buffer, contentType: string = 'image/jpeg'): Promise<void> {
  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.storage.s3Bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000', // 1 year
      })
    );
  } catch (error) {
    throw new Error(`Failed to upload to R2: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkR2Exists(key: string): Promise<boolean> {
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: config.storage.s3Bucket,
        Key: key,
      })
    );
    return true;
  } catch {
    return false;
  }
}

async function processImage(
  image: ImageToProcess,
  dryRun: boolean,
  force: boolean
): Promise<{ success: boolean; r2Url?: string; error?: string }> {
  const imageHash = getImageHash(image.image_url);
  const r2Key = getR2Key(image.group_id, imageHash);
  const r2Url = getR2Url(r2Key);

  try {
    // Check if already uploaded (unless force)
    if (!force && !dryRun) {
      const exists = await checkR2Exists(r2Key);
      if (exists) {
        console.log(`  ⊙ Already uploaded: ${r2Key}`);
        return { success: true, r2Url };
      }
    }

    if (dryRun) {
      console.log(`  [DRY RUN] Would process: ${image.image_url} -> ${r2Key}`);
      return { success: true, r2Url };
    }

    // Download image
    const imageBuffer = await downloadImage(image.image_url);
    console.log(`  Downloaded: ${imageBuffer.length} bytes`);

    // Create thumbnail
    const thumbnail = await createThumbnail(imageBuffer);
    console.log(`  Created thumbnail: ${thumbnail.length} bytes`);

    // Upload to R2
    await uploadToR2(r2Key, thumbnail);
    console.log(`  ✓ Uploaded to R2: ${r2Key}`);

    return { success: true, r2Url };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`  ✗ Error: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

async function updateImageUrl(
  db: any,
  imageId: number,
  newUrl: string,
  originalUrl: string,
  source: string,
  attribution?: string
): Promise<void> {
  await db.run(
    `UPDATE species_images
     SET image_url = ?,
         original_url = ?,
         source = ?,
         attribution = ?,
         license = ?
     WHERE id = ?`,
    [newUrl, originalUrl, source, attribution || 'FishBase.org', 'CC BY-NC', imageId]
  );
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const all = args.includes('--all');
  const speciesIdArg = args.find(arg => arg.startsWith('--species-id='));
  const speciesId = speciesIdArg ? parseInt(speciesIdArg.split('=')[1]) : undefined;

  console.log('\n=== Download & Upload Species Images to R2 ===\n');
  console.log(`Mode: ${dryRun ? '🟡 DRY RUN' : '🔴 EXECUTE'}`);
  console.log(`Force re-upload: ${force}`);
  console.log(`Thumbnail size: ${THUMBNAIL_WIDTH}x${THUMBNAIL_HEIGHT}`);
  console.log(`Quality: ${THUMBNAIL_QUALITY}%\n`);

  const dbPath = join(__dirname, '../db/database.db');
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
    mode: dryRun ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE,
  });

  // Get images to process
  let query = `
    SELECT
      si.id,
      si.group_id,
      si.image_url,
      si.display_order,
      sng.canonical_genus,
      sng.canonical_species_name
    FROM species_images si
    JOIN species_name_group sng ON si.group_id = sng.group_id
    WHERE si.image_url LIKE 'http%'
  `;

  const params: any[] = [];

  if (speciesId) {
    query += ' AND si.group_id = ?';
    params.push(speciesId);
  }

  if (!all && !speciesId) {
    query += ' LIMIT 10';
  }

  query += ' ORDER BY si.group_id, si.display_order';

  const images = await db.all<ImageToProcess[]>(query, params);

  console.log(`Found ${images.length} external images to process\n`);

  if (images.length === 0) {
    console.log('✅ No external images to process');
    await db.close();
    return;
  }

  // Process each image
  const stats = {
    total: images.length,
    success: 0,
    skipped: 0,
    errors: 0,
  };

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const progress = `[${i + 1}/${images.length}]`;

    console.log(
      `${progress} ${image.canonical_genus} ${image.canonical_species_name} (ID: ${image.id})`
    );

    const result = await processImage(image, dryRun, force);

    if (result.success) {
      stats.success++;

      // Update database with R2 URL and metadata (unless dry run)
      if (!dryRun && result.r2Url && result.r2Url !== image.image_url) {
        const source = image.image_url.includes('fishbase.se') ? 'fishbase' :
                       image.image_url.includes('wikipedia.org') ? 'wikipedia' :
                       image.image_url.includes('gbif.org') ? 'gbif' : 'external';

        await updateImageUrl(db, image.id, result.r2Url, image.image_url, source);
        console.log(`  Updated DB: ${result.r2Url}`);
      }
    } else {
      stats.errors++;
    }

    console.log('');
  }

  // Print summary
  console.log('=== Summary ===\n');
  console.log(`Total images: ${stats.total}`);
  console.log(`✓ Processed: ${stats.success}`);
  console.log(`✗ Errors: ${stats.errors}`);

  if (dryRun) {
    console.log('\n[DRY RUN] No changes made');
    console.log('Run without --dry-run to actually process images');
  } else {
    console.log(`\n✅ Images uploaded to R2 bucket: ${config.storage.s3Bucket}`);
    console.log(`Public URL: ${config.storage.r2PublicUrl}`);
  }

  await db.close();
}

main().catch(error => {
  console.error('\n❌ Script failed:', error);
  process.exit(1);
});
