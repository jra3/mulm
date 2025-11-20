/**
 * Sync GBIF External Data
 *
 * Uses the GBIF API to populate species_external_references and species_images
 * tables with data from the Global Biodiversity Information Facility.
 *
 * This script:
 * - Matches species names to GBIF usage keys
 * - Constructs GBIF species page URLs
 * - Generates occurrence map URLs (distribution maps)
 * - Extracts specimen image URLs
 * - Updates normalized tables: species_external_references, species_images
 * - Records sync operations in external_data_sync_log
 *
 * Supports ALL species types:
 * - Fish (additional data beyond FishBase)
 * - Corals/Inverts (specimen photos, distribution)
 * - Plants (occurrence data, images)
 *
 * Usage:
 *   npm run script scripts/sync-gbif-all-species.ts                     # Dry-run (preview)
 *   npm run script scripts/sync-gbif-all-species.ts -- --execute        # Actually sync
 *   npm run script scripts/sync-gbif-all-species.ts -- --limit=10       # Test with 10 species
 *   npm run script scripts/sync-gbif-all-species.ts -- --species-id=123 # Sync one species
 *   npm run script scripts/sync-gbif-all-species.ts -- --species-type=Coral  # Sync only corals
 *   npm run script scripts/sync-gbif-all-species.ts -- --force          # Re-sync even if already synced
 */

import sqlite3 from "sqlite3";
import { open, type Database } from "sqlite";
import { join } from "path";
import { createHash } from "crypto";
import sharp from "sharp";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import config from "../src/config.json";

// GBIF API types (duplicated here to avoid import issues)
interface GBIFSpeciesMatch {
  usageKey: number;
  scientificName: string;
  canonicalName: string;
  confidence: number;
  matchType: string;
}

interface GBIFMedia {
  type: string;
  identifier: string;
}

interface GBIFMediaResponse {
  results: GBIFMedia[];
}

interface GBIFResult {
  usageKey: number;
  gbifUrl: string;
  occurrenceMapUrl: string;
  imageUrls: string[];
  scientificName: string;
  confidence: number;
}

interface OurSpecies {
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
  species_type: string;
  last_external_sync: string | null;
  submission_count?: number;
}

interface ExistingReference {
  reference_url: string;
}

interface ExistingImage {
  image_url: string;
}

interface SyncResult {
  group_id: number;
  scientific_name: string;
  species_type: string;
  gbif_url: string;
  occurrence_map_url: string;
  image_urls: string[];
  new_links: number;
  new_images: number;
  status: "success" | "not_found" | "skipped" | "error";
  error_message?: string;
  confidence?: number;
}

const GBIF_API_BASE = "https://api.gbif.org/v1";
const GBIF_SPECIES_URL = "https://www.gbif.org/species";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Image download and R2 configuration
const IMAGE_CONFIG = {
  maxWidth: 800,
  maxHeight: 600,
  quality: 85,
};

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: "auto",
      endpoint: config.storage.s3Url,
      credentials: {
        accessKeyId: config.storage.s3AccessKeyId,
        secretAccessKey: config.storage.s3Secret,
      },
    });
  }
  return s3Client;
}

function getImageHash(url: string): string {
  return createHash("md5").update(url).digest("hex");
}

function getR2Key(groupId: number, imageHash: string): string {
  return `species-images/${groupId}/${imageHash}.jpg`;
}

function getR2Url(key: string): string {
  return `${config.storage.r2PublicUrl}/${key}`;
}

async function checkR2Exists(r2Key: string): Promise<boolean> {
  try {
    await getS3Client().send(
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

async function downloadAndStoreImage(
  groupId: number,
  externalUrl: string
): Promise<{ r2Url: string; originalUrl: string } | null> {
  try {
    const imageHash = getImageHash(externalUrl);
    const r2Key = getR2Key(groupId, imageHash);

    const exists = await checkR2Exists(r2Key);
    if (exists) {
      return {
        r2Url: getR2Url(r2Key),
        originalUrl: externalUrl,
      };
    }

    const response = await fetch(externalUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BAS-BAP-Bot/1.0)",
      },
    });

    if (!response.ok) {
      console.warn(`    Failed to download ${externalUrl}: HTTP ${response.status}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    const optimizedBuffer = await sharp(imageBuffer)
      .resize(IMAGE_CONFIG.maxWidth, IMAGE_CONFIG.maxHeight, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({
        quality: IMAGE_CONFIG.quality,
        progressive: true,
      })
      .toBuffer();

    await getS3Client().send(
      new PutObjectCommand({
        Bucket: config.storage.s3Bucket,
        Key: r2Key,
        Body: optimizedBuffer,
        ContentType: "image/jpeg",
        CacheControl: "public, max-age=31536000",
      })
    );

    return {
      r2Url: getR2Url(r2Key),
      originalUrl: externalUrl,
    };
  } catch (error: any) {
    console.warn(`    Error processing ${externalUrl}: ${error.message}`);
    return null;
  }
}

/**
 * Match species name to GBIF usage key
 */
async function matchSpecies(genus: string, species: string): Promise<GBIFSpeciesMatch | null> {
  const scientificName = `${genus} ${species}`;

  try {
    const url = `${GBIF_API_BASE}/species/match?name=${encodeURIComponent(scientificName)}&verbose=false`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "BAP-Species-Database/1.0 (mulm project)",
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as GBIFSpeciesMatch;

    // Check if we got a good match
    if (data.matchType === "NONE" || data.confidence < 80) {
      return null;
    }

    return data;
  } catch (error: any) {
    console.error(`  Failed to match species: ${error.message}`);
    return null;
  }
}

/**
 * Get media (images) for a species
 */
async function getSpeciesMedia(usageKey: number, limit = 10): Promise<GBIFMedia[]> {
  try {
    const url = `${GBIF_API_BASE}/species/${usageKey}/media?limit=${limit}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "BAP-Species-Database/1.0 (mulm project)",
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as GBIFMediaResponse;

    if (!data.results) {
      return [];
    }

    // Filter to only images (StillImage)
    return data.results.filter(
      (media) => media.type === "StillImage" && media.identifier
    );
  } catch (error) {
    return [];
  }
}

/**
 * Get external data from GBIF
 */
async function getExternalData(genus: string, species: string): Promise<GBIFResult | null> {
  const match = await matchSpecies(genus, species);

  if (!match) {
    return null;
  }

  // Construct GBIF species page URL
  const gbifUrl = `${GBIF_SPECIES_URL}/${match.usageKey}`;

  // Construct occurrence map URL (distribution map)
  const occurrenceMapUrl = `https://api.gbif.org/v2/map/occurrence/density/0/0/0@1x.png?taxonKey=${match.usageKey}&bin=hex&hexPerTile=30&style=purpleYellow.point`;

  // Get images
  const media = await getSpeciesMedia(match.usageKey, 10);
  const imageUrls = media.map((m) => m.identifier).filter((url) => url && url.length > 0);

  return {
    usageKey: match.usageKey,
    gbifUrl,
    occurrenceMapUrl,
    imageUrls,
    scientificName: match.canonicalName || match.scientificName,
    confidence: match.confidence,
  };
}

async function getExistingReferences(
  sqlite: Database,
  groupId: number
): Promise<Set<string>> {
  const refs = await sqlite.all<ExistingReference[]>(
    "SELECT reference_url FROM species_external_references WHERE group_id = ?",
    [groupId]
  );
  return new Set(refs.map((r) => r.reference_url));
}

async function getExistingImages(sqlite: Database, groupId: number): Promise<Set<string>> {
  const imgs = await sqlite.all<ExistingImage[]>(
    "SELECT image_url FROM species_images WHERE group_id = ?",
    [groupId]
  );
  return new Set(imgs.map((i) => i.image_url));
}

async function syncSpecies(
  sqlite: Database,
  species: OurSpecies,
  force: boolean
): Promise<SyncResult> {
  const scientificName = `${species.canonical_genus} ${species.canonical_species_name}`;

  try {
    // Query GBIF for this species
    const gbifData = await getExternalData(
      species.canonical_genus,
      species.canonical_species_name
    );

    if (!gbifData) {
      return {
        group_id: species.group_id,
        scientific_name: scientificName,
        species_type: species.species_type,
        gbif_url: "",
        occurrence_map_url: "",
        image_urls: [],
        new_links: 0,
        new_images: 0,
        status: "not_found",
      };
    }

    // Get existing data
    const existingRefs = await getExistingReferences(sqlite, species.group_id);
    const existingImages = await getExistingImages(sqlite, species.group_id);

    // Collect all URLs (GBIF page + occurrence map as reference URLs)
    const allUrls = [gbifData.gbifUrl];
    // Note: We'll store the occurrence map URL as a reference, not an image
    // This way users can click through to see the full interactive map

    // Determine what's new
    const newUrls = allUrls.filter((url) => !existingRefs.has(url));
    const newImageUrls = gbifData.imageUrls.filter((url) => !existingImages.has(url));

    if (newUrls.length === 0 && newImageUrls.length === 0 && !force) {
      return {
        group_id: species.group_id,
        scientific_name: scientificName,
        species_type: species.species_type,
        gbif_url: gbifData.gbifUrl,
        occurrence_map_url: gbifData.occurrenceMapUrl,
        image_urls: [],
        new_links: 0,
        new_images: 0,
        status: "skipped",
        confidence: gbifData.confidence,
      };
    }

    return {
      group_id: species.group_id,
      scientific_name: scientificName,
      species_type: species.species_type,
      gbif_url: gbifData.gbifUrl,
      occurrence_map_url: gbifData.occurrenceMapUrl,
      image_urls: newImageUrls,
      new_links: newUrls.length,
      new_images: newImageUrls.length,
      status: "success",
      confidence: gbifData.confidence,
    };
  } catch (error: any) {
    return {
      group_id: species.group_id,
      scientific_name: scientificName,
      species_type: species.species_type,
      gbif_url: "",
      occurrence_map_url: "",
      image_urls: [],
      new_links: 0,
      new_images: 0,
      status: "error",
      error_message: error.message,
    };
  }
}

async function applySync(
  sqlite: Database,
  result: SyncResult,
  downloadImages: boolean
): Promise<void> {
  await sqlite.exec("BEGIN TRANSACTION");

  try {
    const now = new Date().toISOString();

    // Add GBIF URL to external references if new
    if (result.new_links > 0) {
      // Get current max display_order
      const maxOrder = await sqlite.get<{ max_order: number | null }>(
        "SELECT MAX(display_order) as max_order FROM species_external_references WHERE group_id = ?",
        [result.group_id]
      );
      let nextOrder = (maxOrder?.max_order ?? -1) + 1;

      // Add GBIF species page URL
      if (result.gbif_url) {
        await sqlite.run(
          `INSERT INTO species_external_references (group_id, reference_url, display_order)
           VALUES (?, ?, ?)
           ON CONFLICT (group_id, reference_url) DO NOTHING`,
          [result.group_id, result.gbif_url, nextOrder++]
        );
      }
    }

    // Add new images
    if (result.new_images > 0) {
      // Get current max display_order
      const maxOrder = await sqlite.get<{ max_order: number | null }>(
        "SELECT MAX(display_order) as max_order FROM species_images WHERE group_id = ?",
        [result.group_id]
      );
      let nextOrder = (maxOrder?.max_order ?? -1) + 1;

      for (const imageUrl of result.image_urls) {
        let finalImageUrl = imageUrl;
        let originalUrl: string | null = null;
        const source = "gbif";
        const attribution = "GBIF";
        const license = "Various (see source)";

        // Download to R2 if flag is set
        if (downloadImages) {
          console.log(`    Downloading image to R2...`);
          const downloadResult = await downloadAndStoreImage(result.group_id, imageUrl);
          if (downloadResult) {
            finalImageUrl = downloadResult.r2Url;
            originalUrl = downloadResult.originalUrl;
          } else {
            console.warn(`    Keeping external URL due to download failure`);
          }
        }

        // Insert with metadata
        await sqlite.run(
          `INSERT INTO species_images (group_id, image_url, display_order, source, attribution, license, original_url)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (group_id, image_url) DO NOTHING`,
          [result.group_id, finalImageUrl, nextOrder++, source, attribution, license, originalUrl]
        );
      }
    }

    // Update last_external_sync timestamp
    await sqlite.run(
      "UPDATE species_name_group SET last_external_sync = ? WHERE group_id = ?",
      [now, result.group_id]
    );

    // Record sync in log
    await sqlite.run(
      `INSERT INTO external_data_sync_log
       (group_id, source, sync_date, status, links_added, images_added, error_message)
       VALUES (?, 'gbif', ?, ?, ?, ?, ?)`,
      [
        result.group_id,
        now,
        result.status,
        result.new_links,
        result.new_images,
        result.error_message || null,
      ]
    );

    await sqlite.exec("COMMIT");
  } catch (error) {
    await sqlite.exec("ROLLBACK");
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const force = args.includes("--force");
  const downloadImages = args.includes("--download-images");
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1]) : undefined;
  const speciesIdArg = args.find((arg) => arg.startsWith("--species-id="));
  const speciesId = speciesIdArg ? parseInt(speciesIdArg.split("=")[1]) : undefined;
  const speciesTypeArg = args.find((arg) => arg.startsWith("--species-type="));
  const speciesType = speciesTypeArg ? speciesTypeArg.split("=")[1] : undefined;
  const dbArg = args.find((arg) => arg.startsWith("--db="));
  const customDbPath = dbArg ? dbArg.split("=")[1] : null;

  console.log("\n=== GBIF External Data Sync ===\n");
  console.log(
    `Mode: ${execute ? "🔴 EXECUTE (will modify database)" : "🟡 DRY-RUN (preview only)"}`
  );
  console.log(`Force resync: ${force}`);
  console.log(`Download images to R2: ${downloadImages ? "YES" : "NO (store external URLs)"}`);
  if (limit) {
    console.log(`Limit: Processing first ${limit} species only`);
  }
  if (speciesId) {
    console.log(`Single species: ID ${speciesId}`);
  }
  if (speciesType) {
    console.log(`Species type filter: ${speciesType}`);
  }
  console.log("");

  // Connect to SQLite database
  const dbPath = customDbPath || process.env.DB_PATH || join(__dirname, "../db/database.db");
  console.log(`Database: ${dbPath}\n`);
  const sqlite = await open({
    filename: dbPath,
    driver: sqlite3.Database,
    mode: execute ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY,
  });

  // Test connection by trying a simple query
  console.log("Testing GBIF API connection...");
  try {
    const testResult = await matchSpecies("Poecilia", "reticulata");
    if (!testResult) {
      console.error("❌ GBIF test query returned no results");
      process.exit(1);
    }
    console.log("✅ GBIF API accessible\n");
  } catch (error: any) {
    console.error(`❌ Failed to connect to GBIF API: ${error.message}`);
    process.exit(1);
  }

  // Get species to sync
  let query: string;
  let params: any[] = [];

  if (speciesId) {
    // Sync specific species
    query = `
      SELECT group_id, canonical_genus, canonical_species_name, species_type, last_external_sync
      FROM species_name_group
      WHERE group_id = ?
    `;
    params = [speciesId];
  } else {
    // Sync ALL species in database
    query = `
      SELECT
        group_id,
        canonical_genus,
        canonical_species_name,
        species_type,
        last_external_sync
      FROM species_name_group
      WHERE 1=1
        ${speciesType ? "AND species_type = ?" : ""}
        ${!force ? `
        AND NOT EXISTS (
          SELECT 1 FROM external_data_sync_log edsl
          WHERE edsl.group_id = species_name_group.group_id
          AND edsl.source = 'gbif'
          AND edsl.sync_date > datetime('now', '-90 days')
        )` : ""}
      ORDER BY group_id
      ${limit ? `LIMIT ${limit}` : ""}
    `;

    if (speciesType) {
      params.push(speciesType);
    }
  }

  const species = await sqlite.all<OurSpecies[]>(query, params);
  console.log(`Found ${species.length} species to process\n`);

  if (species.length === 0) {
    console.log("No species found to sync. Exiting.");
    await sqlite.close();
    return;
  }

  // Group by species type for reporting
  const byType = species.reduce(
    (acc, s) => {
      acc[s.species_type] = (acc[s.species_type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  console.log("Species breakdown by type:");
  for (const [type, count] of Object.entries(byType)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log("");

  // Sync species
  const results: SyncResult[] = [];
  let processed = 0;

  for (const sp of species) {
    processed++;
    const scientificName = `${sp.canonical_genus} ${sp.canonical_species_name}`;

    process.stdout.write(
      `[${processed}/${species.length}] Processing ${scientificName} (${sp.species_type})...`
    );

    const result = await syncSpecies(sqlite, sp, force);
    results.push(result);

    if (result.status === "success") {
      console.log(
        ` ✅ ${result.new_links} links, ${result.new_images} images (confidence: ${result.confidence}%)`
      );
    } else if (result.status === "skipped") {
      console.log(` ⏭️  Already synced`);
    } else if (result.status === "not_found") {
      console.log(` ❌ Not found`);
    } else if (result.status === "error") {
      console.log(` ⚠️  Error: ${result.error_message}`);
    }

    // Apply sync if executing
    if (execute && (result.status === "success" || result.status === "not_found")) {
      await applySync(sqlite, result, downloadImages);
    }

    // Small delay to be nice to the API
    await sleep(120);
  }

  // Summary
  console.log("\n=== Summary ===\n");

  const successCount = results.filter((r) => r.status === "success").length;
  const notFoundCount = results.filter((r) => r.status === "not_found").length;
  const skippedCount = results.filter((r) => r.status === "skipped").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  const totalLinks = results.reduce((sum, r) => sum + r.new_links, 0);
  const totalImages = results.reduce((sum, r) => sum + r.new_images, 0);

  console.log(`Total processed: ${species.length}`);
  console.log(`  ✅ Success: ${successCount}`);
  console.log(`  ❌ Not found: ${notFoundCount}`);
  console.log(`  ⏭️  Skipped: ${skippedCount}`);
  console.log(`  ⚠️  Errors: ${errorCount}`);
  console.log("");
  console.log(`Total new links: ${totalLinks}`);
  console.log(`Total new images: ${totalImages}`);
  console.log("");

  // Show species not found (for investigation)
  if (notFoundCount > 0) {
    console.log("\nSpecies not found in GBIF:");
    results
      .filter((r) => r.status === "not_found")
      .forEach((r) => {
        console.log(`  - ${r.scientific_name} (${r.species_type}, ID: ${r.group_id})`);
      });
  }

  // Show errors
  if (errorCount > 0) {
    console.log("\nErrors encountered:");
    results
      .filter((r) => r.status === "error")
      .forEach((r) => {
        console.log(`  - ${r.scientific_name}: ${r.error_message}`);
      });
  }

  // Top species with most data added
  if (successCount > 0) {
    console.log("\nTop species synced (most data added):");
    const topSpecies = results
      .filter((r) => r.status === "success")
      .sort((a, b) => b.new_links + b.new_images - (a.new_links + a.new_images))
      .slice(0, 10);

    topSpecies.forEach((r) => {
      console.log(
        `  - ${r.scientific_name} (${r.species_type}): ${r.new_links} links, ${r.new_images} images`
      );
    });
  }

  console.log(
    `\n${execute ? "✅ Sync completed!" : "🟡 Dry-run completed. Use --execute to apply changes."}\n`
  );

  await sqlite.close();
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
