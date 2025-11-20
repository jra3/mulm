/**
 * Sync Wikipedia/Wikidata External Data - ALL Species
 *
 * Syncs ALL species in the database (not just those with submissions).
 * Designed for comprehensive external data coverage across the entire catalog.
 *
 * This script:
 * - Queries ALL species in the database
 * - Syncs with Wikipedia/Wikidata
 * - Uses conservative rate limiting (slow and steady)
 * - Supports batching to avoid overwhelming APIs
 * - Logs all operations
 *
 * Supports ALL species types: Fish, Corals, Inverts, Plants
 *
 * Usage:
 *   npm run script scripts/sync-wikipedia-all-species.ts                     # Dry-run (preview)
 *   npm run script scripts/sync-wikipedia-all-species.ts -- --execute        # Actually sync
 *   npm run script scripts/sync-wikipedia-all-species.ts -- --batch-size=100 # Process 100 at a time
 *   npm run script scripts/sync-wikipedia-all-species.ts -- --species-type=Coral  # Sync only corals
 *   npm run script scripts/sync-wikipedia-all-species.ts -- --force          # Re-sync even if already synced
 *   npm run script scripts/sync-wikipedia-all-species.ts -- --start-after=500  # Resume from species ID 500
 *
 * Recommended for production:
 *   npm run script scripts/sync-wikipedia-all-species.ts -- --execute --batch-size=500
 *
 * For VERY large syncs (2000+ species), run in batches:
 *   npm run script scripts/sync-wikipedia-all-species.ts -- --execute --batch-size=500
 *   # Wait, then run again to get next batch
 */

import sqlite3 from "sqlite3";
import { open, type Database } from "sqlite";
import { join } from "path";
import { createHash } from "crypto";
import sharp from "sharp";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import config from "../src/config.json";

// Wikipedia/Wikidata API types
interface WikidataSpeciesResult {
  item: {
    type: string;
    value: string;
  };
  itemLabel?: {
    type: string;
    value: string;
    "xml:lang": string;
  };
  article?: {
    type: string;
    value: string;
  };
  image?: {
    type: string;
    value: string;
  };
}

interface WikidataQueryResponse {
  head: {
    vars: string[];
  };
  results: {
    bindings: WikidataSpeciesResult[];
  };
}

interface WikipediaPageSummary {
  title: string;
  pageid: number;
  thumbnail?: {
    source: string;
    width: number;
    height: number;
  };
  originalimage?: {
    source: string;
    width: number;
    height: number;
  };
  content_urls: {
    desktop: {
      page: string;
    };
  };
}

interface WikipediaResult {
  wikidataId: string;
  wikidataUrl: string;
  wikipediaUrls: Record<string, string>;
  imageUrls: string[];
  scientificName: string;
}

interface OurSpecies {
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
  species_type: string;
  last_external_sync: string | null;
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
  wikidata_url: string;
  wikipedia_urls: Record<string, string>;
  image_urls: string[];
  new_links: number;
  new_images: number;
  status: "success" | "not_found" | "skipped" | "error";
  error_message?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Image download and R2 configuration
const IMAGE_CONFIG = {
  maxWidth: 800,
  maxHeight: 600,
  quality: 85,
};

// Initialize R2/S3 client (lazy)
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

/**
 * Generate MD5 hash from URL
 */
function getImageHash(url: string): string {
  return createHash("md5").update(url).digest("hex");
}

/**
 * Generate R2 key
 */
function getR2Key(groupId: number, imageHash: string): string {
  return `species-images/${groupId}/${imageHash}.jpg`;
}

/**
 * Get R2 public URL
 */
function getR2Url(key: string): string {
  return `${config.storage.r2PublicUrl}/${key}`;
}

/**
 * Check if image exists in R2
 */
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

/**
 * Download, transcode, and upload image to R2
 */
async function downloadAndStoreImage(
  groupId: number,
  externalUrl: string
): Promise<{ r2Url: string; originalUrl: string } | null> {
  try {
    const imageHash = getImageHash(externalUrl);
    const r2Key = getR2Key(groupId, imageHash);

    // Check if already in R2
    const exists = await checkR2Exists(r2Key);
    if (exists) {
      return {
        r2Url: getR2Url(r2Key),
        originalUrl: externalUrl,
      };
    }

    // Download
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

    // Transcode
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

    // Upload to R2
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
 * Query Wikidata SPARQL for a species
 */
async function queryWikidata(
  genus: string,
  species: string
): Promise<WikidataSpeciesResult[]> {
  const scientificName = `${genus} ${species}`;

  const sparqlQuery = `
SELECT DISTINCT ?item ?itemLabel ?article ?image WHERE {
  ?item wdt:P225 "${scientificName}" .
  OPTIONAL {
    ?article schema:about ?item ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }
  OPTIONAL {
    ?item wdt:P18 ?image .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 5
  `.trim();

  try {
    const sparqlEndpoint = "https://query.wikidata.org/sparql";
    const url =
      sparqlEndpoint +
      "?" +
      new URLSearchParams({
        query: sparqlQuery,
        format: "json",
      }).toString();

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent": "BAP-Species-Database/1.0 (mulm project)",
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as WikidataQueryResponse;

    if (!data.results || data.results.bindings.length === 0) {
      return [];
    }

    return data.results.bindings;
  } catch (error: any) {
    return [];
  }
}

/**
 * Get Wikipedia page summary
 */
async function getWikipediaPageSummary(
  title: string,
  lang = "en"
): Promise<WikipediaPageSummary | null> {
  try {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;

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

    return await response.json();
  } catch (error) {
    return null;
  }
}

/**
 * Get external data from Wikipedia/Wikidata
 */
async function getExternalData(
  genus: string,
  species: string
): Promise<WikipediaResult | null> {
  const wikidataResults = await queryWikidata(genus, species);

  if (wikidataResults.length === 0) {
    return null;
  }

  const primaryResult = wikidataResults[0];

  // Extract Wikidata ID from URL
  const wikidataUrlMatch = primaryResult.item.value.match(/Q\d+$/);
  if (!wikidataUrlMatch) {
    return null;
  }

  const wikidataId = wikidataUrlMatch[0];
  const wikidataUrl = primaryResult.item.value;

  // Collect Wikipedia article URLs
  const wikipediaUrls: Record<string, string> = {};

  if (primaryResult.article) {
    wikipediaUrls.en = primaryResult.article.value;
  }

  // Try to get page summary for more details
  const scientificName = `${genus} ${species}`;
  const pageSummary = await getWikipediaPageSummary(scientificName, "en");

  if (pageSummary && pageSummary.content_urls.desktop.page) {
    wikipediaUrls.en = pageSummary.content_urls.desktop.page;
  }

  // Collect image URLs
  const imageUrls: string[] = [];

  if (primaryResult.image) {
    imageUrls.push(primaryResult.image.value);
  }

  if (pageSummary?.originalimage) {
    if (!imageUrls.includes(pageSummary.originalimage.source)) {
      imageUrls.push(pageSummary.originalimage.source);
    }
  }

  if (pageSummary?.thumbnail) {
    if (!imageUrls.includes(pageSummary.thumbnail.source)) {
      imageUrls.push(pageSummary.thumbnail.source);
    }
  }

  return {
    wikidataId,
    wikidataUrl,
    wikipediaUrls,
    imageUrls,
    scientificName,
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
    // Query Wikipedia/Wikidata for this species
    const wikiData = await getExternalData(
      species.canonical_genus,
      species.canonical_species_name
    );

    if (!wikiData) {
      return {
        group_id: species.group_id,
        scientific_name: scientificName,
        species_type: species.species_type,
        wikidata_url: "",
        wikipedia_urls: {},
        image_urls: [],
        new_links: 0,
        new_images: 0,
        status: "not_found",
      };
    }

    // Get existing data
    const existingRefs = await getExistingReferences(sqlite, species.group_id);
    const existingImages = await getExistingImages(sqlite, species.group_id);

    // Collect all URLs (Wikidata + Wikipedia articles)
    const allUrls = [wikiData.wikidataUrl, ...Object.values(wikiData.wikipediaUrls)];

    // Determine what's new
    const newUrls = allUrls.filter((url) => !existingRefs.has(url));
    const newImageUrls = wikiData.imageUrls.filter((url) => !existingImages.has(url));

    if (newUrls.length === 0 && newImageUrls.length === 0 && !force) {
      return {
        group_id: species.group_id,
        scientific_name: scientificName,
        species_type: species.species_type,
        wikidata_url: wikiData.wikidataUrl,
        wikipedia_urls: wikiData.wikipediaUrls,
        image_urls: [],
        new_links: 0,
        new_images: 0,
        status: "skipped",
      };
    }

    return {
      group_id: species.group_id,
      scientific_name: scientificName,
      species_type: species.species_type,
      wikidata_url: wikiData.wikidataUrl,
      wikipedia_urls: wikiData.wikipediaUrls,
      image_urls: newImageUrls,
      new_links: newUrls.length,
      new_images: newImageUrls.length,
      status: "success",
    };
  } catch (error: any) {
    return {
      group_id: species.group_id,
      scientific_name: scientificName,
      species_type: species.species_type,
      wikidata_url: "",
      wikipedia_urls: {},
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

    // Add Wikidata and Wikipedia URLs to external references if new
    if (result.new_links > 0) {
      // Get current max display_order
      const maxOrder = await sqlite.get<{ max_order: number | null }>(
        "SELECT MAX(display_order) as max_order FROM species_external_references WHERE group_id = ?",
        [result.group_id]
      );
      let nextOrder = (maxOrder?.max_order ?? -1) + 1;

      // Add Wikidata URL first
      if (result.wikidata_url) {
        await sqlite.run(
          `INSERT INTO species_external_references (group_id, reference_url, display_order)
           VALUES (?, ?, ?)
           ON CONFLICT (group_id, reference_url) DO NOTHING`,
          [result.group_id, result.wikidata_url, nextOrder++]
        );
      }

      // Add Wikipedia article URLs
      const wikipediaUrls = Object.entries(result.wikipedia_urls);
      const enWiki = wikipediaUrls.find(([lang]) => lang === "en");
      const otherWikis = wikipediaUrls.filter(([lang]) => lang !== "en");

      if (enWiki) {
        await sqlite.run(
          `INSERT INTO species_external_references (group_id, reference_url, display_order)
           VALUES (?, ?, ?)
           ON CONFLICT (group_id, reference_url) DO NOTHING`,
          [result.group_id, enWiki[1], nextOrder++]
        );
      }

      for (const [, url] of otherWikis) {
        await sqlite.run(
          `INSERT INTO species_external_references (group_id, reference_url, display_order)
           VALUES (?, ?, ?)
           ON CONFLICT (group_id, reference_url) DO NOTHING`,
          [result.group_id, url, nextOrder++]
        );
      }
    }

    // Add new images
    if (result.new_images > 0) {
      const maxOrder = await sqlite.get<{ max_order: number | null }>(
        "SELECT MAX(display_order) as max_order FROM species_images WHERE group_id = ?",
        [result.group_id]
      );
      let nextOrder = (maxOrder?.max_order ?? -1) + 1;

      for (const imageUrl of result.image_urls) {
        let finalImageUrl = imageUrl;
        let originalUrl: string | null = null;
        let source = "wikipedia";
        let attribution = "Wikipedia/Wikimedia Commons";
        let license = "Various CC licenses";

        // Download to R2 if flag is set
        if (downloadImages) {
          console.log(`    Downloading image to R2...`);
          const downloadResult = await downloadAndStoreImage(result.group_id, imageUrl);
          if (downloadResult) {
            finalImageUrl = downloadResult.r2Url;
            originalUrl = downloadResult.originalUrl;
          } else {
            // Download failed, keep external URL
            console.warn(`    Keeping external URL due to download failure`);
          }
        }

        // Insert with metadata
        await sqlite.run(
          `INSERT INTO species_images (group_id, image_url, display_order, source, attribution, license, original_url)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (group_id, image_url) DO NOTHING`,
          [
            result.group_id,
            finalImageUrl,
            nextOrder++,
            source,
            attribution,
            license,
            originalUrl,
          ]
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
       VALUES (?, 'wikipedia', ?, ?, ?, ?, ?)`,
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
  const batchSizeArg = args.find((arg) => arg.startsWith("--batch-size="));
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.split("=")[1]) : undefined;
  const speciesTypeArg = args.find((arg) => arg.startsWith("--species-type="));
  const speciesType = speciesTypeArg ? speciesTypeArg.split("=")[1] : undefined;
  const startAfterArg = args.find((arg) => arg.startsWith("--start-after="));
  const startAfter = startAfterArg ? parseInt(startAfterArg.split("=")[1]) : undefined;
  const dbArg = args.find((arg) => arg.startsWith("--db="));
  const customDbPath = dbArg ? dbArg.split("=")[1] : null;

  console.log("\n=== Wikipedia/Wikidata Full Database Sync ===\n");
  console.log(
    `Mode: ${execute ? "🔴 EXECUTE (will modify database)" : "🟡 DRY-RUN (preview only)"}`
  );
  console.log(`Force resync: ${force}`);
  console.log(`Download images to R2: ${downloadImages ? "YES" : "NO (store external URLs)"}`);
  if (batchSize) {
    console.log(`Batch size: ${batchSize} species per run`);
  }
  if (speciesType) {
    console.log(`Species type filter: ${speciesType}`);
  }
  if (startAfter) {
    console.log(`Starting after species ID: ${startAfter}`);
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

  // Test connection
  console.log("Testing Wikipedia/Wikidata API connection...");
  try {
    const testResult = await queryWikidata("Poecilia", "reticulata");
    if (testResult.length === 0) {
      console.error("❌ Wikipedia/Wikidata test query returned no results");
      process.exit(1);
    }
    console.log("✅ Wikipedia/Wikidata APIs accessible\n");
  } catch (error: any) {
    console.error(`❌ Failed to connect to Wikipedia/Wikidata APIs: ${error.message}`);
    process.exit(1);
  }

  // Get ALL species (not just those with submissions)
  let query = `
    SELECT
      sng.group_id,
      sng.canonical_genus,
      sng.canonical_species_name,
      sng.species_type,
      sng.last_external_sync
    FROM species_name_group sng
    WHERE 1=1
      ${speciesType ? "AND sng.species_type = ?" : ""}
      ${!force ? `
      AND NOT EXISTS (
        SELECT 1 FROM external_data_sync_log edsl
        WHERE edsl.group_id = sng.group_id
        AND edsl.source = 'wikipedia'
        AND edsl.sync_date > datetime('now', '-90 days')
      )` : ""}
      ${startAfter ? "AND sng.group_id > ?" : ""}
    ORDER BY sng.group_id
    ${batchSize ? `LIMIT ${batchSize}` : ""}
  `;

  const params: any[] = [];
  if (speciesType) params.push(speciesType);
  if (startAfter) params.push(startAfter);

  const species = await sqlite.all<OurSpecies[]>(query, params);

  console.log(`Found ${species.length} species to process\n`);

  if (species.length === 0) {
    console.log("No species found to sync. Exiting.");
    await sqlite.close();
    return;
  }

  // Show total species count for context
  const totalCount = await sqlite.get<{ total: number }>(
    `SELECT COUNT(*) as total FROM species_name_group ${speciesType ? "WHERE species_type = ?" : ""}`,
    speciesType ? [speciesType] : []
  );
  console.log(`Total species in database: ${totalCount?.total || 0}`);
  console.log(`Processing: ${species.length} (${((species.length / (totalCount?.total || 1)) * 100).toFixed(1)}%)\n`);

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
  const startTime = Date.now();

  for (const sp of species) {
    processed++;
    const scientificName = `${sp.canonical_genus} ${sp.canonical_species_name}`;

    process.stdout.write(
      `[${processed}/${species.length}] ${sp.group_id}: ${scientificName} (${sp.species_type})...`
    );

    const result = await syncSpecies(sqlite, sp, force);
    results.push(result);

    if (result.status === "success") {
      console.log(` ✅ ${result.new_links} links, ${result.new_images} images`);
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

    // Conservative delay (150ms) to be very respectful to APIs
    await sleep(150);

    // Progress update every 50 species
    if (processed % 50 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      const rate = processed / (Date.now() - startTime) * 1000 * 60;
      const remaining = Math.ceil((species.length - processed) / rate);
      console.log(
        `  📊 Progress: ${processed}/${species.length} (${elapsed} min elapsed, ~${remaining} min remaining)`
      );
    }
  }

  // Summary
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

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
  console.log(`Time elapsed: ${totalTime} minutes`);
  console.log("");

  // Show last species ID for resume
  if (species.length > 0) {
    const lastId = species[species.length - 1].group_id;
    console.log(`Last species ID processed: ${lastId}`);
    console.log(`To resume from next batch: --start-after=${lastId}\n`);
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
