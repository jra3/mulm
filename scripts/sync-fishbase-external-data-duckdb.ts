/**
 * Sync FishBase External Data via DuckDB
 *
 * Uses the existing DuckDB/Parquet FishBase integration to populate
 * species_external_references and species_images tables.
 *
 * This script:
 * - Queries FishBase parquet data for species matches
 * - Constructs FishBase species page URLs
 * - Extracts image URLs from FishBase data
 * - Updates normalized tables: species_external_references, species_images
 * - Records sync operations in external_data_sync_log
 *
 * Usage:
 *   npm run script scripts/sync-fishbase-external-data-duckdb.ts                  # Dry-run (preview)
 *   npm run script scripts/sync-fishbase-external-data-duckdb.ts -- --execute     # Actually sync
 *   npm run script scripts/sync-fishbase-external-data-duckdb.ts -- --limit=10    # Test with 10 species
 *   npm run script scripts/sync-fishbase-external-data-duckdb.ts -- --species-id=123  # Sync one species
 *   npm run script scripts/sync-fishbase-external-data-duckdb.ts -- --force       # Re-sync even if already synced
 */

import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { createDuckDBConnection, createFishBaseView, type DuckDBConnection } from './fishbase/duckdb-utils';
import { join } from 'path';

interface OurSpecies {
  group_id: number;
  canonical_genus: string;
  canonical_species_name: string;
  last_external_sync: string | null;
  submission_count?: number;
}

interface FishBaseSpecies {
  SpecCode: number;
  Genus: string;
  Species: string;
  PicPreferredName: string | null;
  PicPreferredNameM: string | null;
  PicPreferredNameF: string | null;
  PicPreferredNameJ: string | null;
  Pic: string | null;
  PictureFemale: string | null;
  LarvaPic: string | null;
  EggPic: string | null;
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
  spec_code: number;
  fishbase_url: string;
  image_urls: string[];
  new_links: number;
  new_images: number;
  status: 'success' | 'not_found' | 'skipped';
}

const FISHBASE_URL_BASE = 'https://www.fishbase.se/summary/';
const FISHBASE_IMAGE_BASE = 'https://www.fishbase.se/images/species/';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function getFishBaseUrl(specCode: number): string {
  return `${FISHBASE_URL_BASE}${specCode}`;
}

function getFishBaseImageUrl(filename: string): string {
  return `${FISHBASE_IMAGE_BASE}${filename}`;
}

async function getExistingReferences(sqlite: Database, groupId: number): Promise<Set<string>> {
  const refs = await sqlite.all<ExistingReference[]>(
    'SELECT reference_url FROM species_external_references WHERE group_id = ?',
    [groupId]
  );
  return new Set(refs.map(r => r.reference_url));
}

async function getExistingImages(sqlite: Database, groupId: number): Promise<Set<string>> {
  const imgs = await sqlite.all<ExistingImage[]>(
    'SELECT image_url FROM species_images WHERE group_id = ?',
    [groupId]
  );
  return new Set(imgs.map(i => i.image_url));
}

async function syncSpecies(
  sqlite: Database,
  duckConn: DuckDBConnection,
  species: OurSpecies,
  force: boolean
): Promise<SyncResult> {
  const scientificName = `${species.canonical_genus} ${species.canonical_species_name}`;

  try {
    // Query FishBase for this species
    const fishbaseSpecies = await duckConn.all<FishBaseSpecies>(`
      SELECT
        SpecCode, Genus, Species,
        PicPreferredName, PicPreferredNameM, PicPreferredNameF, PicPreferredNameJ,
        Pic, PictureFemale, LarvaPic, EggPic
      FROM fb_species
      WHERE LOWER(Genus) = LOWER(?)
        AND LOWER(Species) = LOWER(?)
      LIMIT 1
    `, species.canonical_genus, species.canonical_species_name);

    if (fishbaseSpecies.length === 0) {
      return {
        group_id: species.group_id,
        scientific_name: scientificName,
        spec_code: 0,
        fishbase_url: '',
        image_urls: [],
        new_links: 0,
        new_images: 0,
        status: 'not_found',
      };
    }

    const fbSpecies = fishbaseSpecies[0];
    const specCode = fbSpecies.SpecCode;
    const fishbaseUrl = getFishBaseUrl(specCode);

    // Collect image URLs
    const imageUrls: string[] = [];
    const addImage = (filename: string | null) => {
      if (filename) {
        const url = getFishBaseImageUrl(filename);
        if (!imageUrls.includes(url)) {
          imageUrls.push(url);
        }
      }
    };

    // Add images in order of preference
    addImage(fbSpecies.PicPreferredName);
    addImage(fbSpecies.PicPreferredNameM);
    addImage(fbSpecies.PicPreferredNameF);
    addImage(fbSpecies.PicPreferredNameJ);
    addImage(fbSpecies.Pic);
    addImage(fbSpecies.PictureFemale);
    addImage(fbSpecies.LarvaPic);
    addImage(fbSpecies.EggPic);

    // Get existing data
    const existingRefs = await getExistingReferences(sqlite, species.group_id);
    const existingImages = await getExistingImages(sqlite, species.group_id);

    // Determine what's new
    const hasUrl = existingRefs.has(fishbaseUrl);
    const newImageUrls = imageUrls.filter(url => !existingImages.has(url));

    if (hasUrl && newImageUrls.length === 0 && !force) {
      return {
        group_id: species.group_id,
        scientific_name: scientificName,
        spec_code: specCode,
        fishbase_url: fishbaseUrl,
        image_urls: imageUrls,
        new_links: 0,
        new_images: 0,
        status: 'skipped',
      };
    }

    return {
      group_id: species.group_id,
      scientific_name: scientificName,
      spec_code: specCode,
      fishbase_url: fishbaseUrl,
      image_urls: newImageUrls,
      new_links: hasUrl ? 0 : 1,
      new_images: newImageUrls.length,
      status: 'success',
    };
  } catch (error: any) {
    throw new Error(`Failed to sync ${scientificName}: ${error.message}`);
  }
}

async function applySync(sqlite: Database, result: SyncResult): Promise<void> {
  await sqlite.exec('BEGIN TRANSACTION');

  try {
    const now = new Date().toISOString();

    // Add FishBase URL to external references if new
    if (result.new_links > 0) {
      // Get current max display_order
      const maxOrder = await sqlite.get<{ max_order: number | null }>(
        'SELECT MAX(display_order) as max_order FROM species_external_references WHERE group_id = ?',
        [result.group_id]
      );
      const nextOrder = (maxOrder?.max_order ?? -1) + 1;

      await sqlite.run(
        `INSERT INTO species_external_references (group_id, reference_url, display_order)
         VALUES (?, ?, ?)
         ON CONFLICT (group_id, reference_url) DO NOTHING`,
        [result.group_id, result.fishbase_url, nextOrder]
      );
    }

    // Add new images
    if (result.new_images > 0) {
      // Get current max display_order
      const maxOrder = await sqlite.get<{ max_order: number | null }>(
        'SELECT MAX(display_order) as max_order FROM species_images WHERE group_id = ?',
        [result.group_id]
      );
      let nextOrder = (maxOrder?.max_order ?? -1) + 1;

      for (const imageUrl of result.image_urls) {
        await sqlite.run(
          `INSERT INTO species_images (group_id, image_url, display_order)
           VALUES (?, ?, ?)
           ON CONFLICT (group_id, image_url) DO NOTHING`,
          [result.group_id, imageUrl, nextOrder++]
        );
      }
    }

    // Update last_external_sync timestamp
    await sqlite.run(
      'UPDATE species_name_group SET last_external_sync = ? WHERE group_id = ?',
      [now, result.group_id]
    );

    // Record sync in log
    await sqlite.run(
      `INSERT INTO external_data_sync_log
       (group_id, source, sync_date, status, links_added, images_added, error_message)
       VALUES (?, 'fishbase', ?, 'success', ?, ?, NULL)`,
      [result.group_id, now, result.new_links, result.new_images]
    );

    await sqlite.exec('COMMIT');
  } catch (error) {
    await sqlite.exec('ROLLBACK');
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const force = args.includes('--force');
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;
  const speciesIdArg = args.find(arg => arg.startsWith('--species-id='));
  const speciesId = speciesIdArg ? parseInt(speciesIdArg.split('=')[1]) : undefined;
  const dbArg = args.find(arg => arg.startsWith('--db='));
  const customDbPath = dbArg ? dbArg.split('=')[1] : null;

  console.log('\n=== FishBase External Data Sync (DuckDB) ===\n');
  console.log(`Mode: ${execute ? '🔴 EXECUTE (will modify database)' : '🟡 DRY-RUN (preview only)'}`);
  console.log(`Force resync: ${force}`);
  if (limit) {
    console.log(`Limit: Processing first ${limit} species only`);
  }
  if (speciesId) {
    console.log(`Single species: ID ${speciesId}`);
  }
  console.log('');

  // Connect to SQLite database
  const dbPath = customDbPath || process.env.DB_PATH || join(__dirname, '../db/database.db');
  console.log(`Database: ${dbPath}\n`);
  const sqlite = await open({
    filename: dbPath,
    driver: sqlite3.Database,
    mode: execute ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY,
  });

  // Get species to sync
  let query: string;
  let params: any[] = [];

  if (speciesId) {
    // Sync specific species
    query = `
      SELECT group_id, canonical_genus, canonical_species_name, last_external_sync
      FROM species_name_group
      WHERE group_id = ? AND species_type = 'Fish'
    `;
    params = [speciesId];
  } else {
    // Sync species with submissions that are missing external data
    query = `
      SELECT
        sng.group_id,
        sng.canonical_genus,
        sng.canonical_species_name,
        sng.last_external_sync,
        COUNT(DISTINCT s.id) as submission_count
      FROM species_name_group sng
      INNER JOIN species_scientific_name ssn ON sng.group_id = ssn.group_id
      INNER JOIN submissions s ON s.scientific_name_id = ssn.scientific_name_id
      WHERE sng.species_type = 'Fish'
        AND s.approved_on IS NOT NULL
        ${force ? '' : `
        AND NOT EXISTS (
          SELECT 1 FROM species_external_references ser
          WHERE ser.group_id = sng.group_id
          AND ser.reference_url LIKE 'https://www.fishbase.se/summary/%'
        )`}
      GROUP BY sng.group_id, sng.canonical_genus, sng.canonical_species_name, sng.last_external_sync
      ORDER BY submission_count DESC, sng.canonical_genus, sng.canonical_species_name
    `;

    if (limit) {
      query += ` LIMIT ${limit}`;
    }
  }

  const ourSpecies: OurSpecies[] = await sqlite.all(query, params);
  console.log(`Found ${ourSpecies.length} species to sync\n`);

  if (ourSpecies.length === 0) {
    console.log('✅ No species need syncing');
    await sqlite.close();
    return;
  }

  // Connect to DuckDB and load FishBase data
  console.log('Loading FishBase data...');
  const duckConn = await createDuckDBConnection();
  await createFishBaseView(duckConn, 'species');
  console.log('FishBase data loaded\n');

  // Track statistics
  const stats = {
    total: ourSpecies.length,
    success: 0,
    notFound: 0,
    skipped: 0,
    errors: 0,
    totalLinksAdded: 0,
    totalImagesAdded: 0,
  };

  const results: SyncResult[] = [];

  console.log('Syncing species with FishBase...\n');

  for (let i = 0; i < ourSpecies.length; i++) {
    const sp = ourSpecies[i];
    const progress = `[${i + 1}/${ourSpecies.length}]`;

    try {
      const result = await syncSpecies(sqlite, duckConn, sp, force);
      results.push(result);

      if (result.status === 'success') {
        stats.success++;
        stats.totalLinksAdded += result.new_links;
        stats.totalImagesAdded += result.new_images;
        console.log(
          `${progress} ✓ ${result.scientific_name}${sp.submission_count ? ` (${sp.submission_count} submissions)` : ''} - ${result.new_links} link(s), ${result.new_images} image(s)`
        );
      } else if (result.status === 'not_found') {
        stats.notFound++;
        console.log(`${progress} ⊗ ${sp.canonical_genus} ${sp.canonical_species_name} - Not found in FishBase`);
      } else {
        stats.skipped++;
        console.log(`${progress} ⊙ ${sp.canonical_genus} ${sp.canonical_species_name} - Skipped (already synced)`);
      }

      // Small delay to be respectful
      if (i % 10 === 0 && i > 0) {
        await sleep(100);
      }
    } catch (error: any) {
      stats.errors++;
      console.error(`${progress} ✗ ${sp.canonical_genus} ${sp.canonical_species_name} - Error: ${error.message}`);
    }
  }

  await duckConn.close();

  // Print summary
  console.log('\n=== Sync Summary ===\n');
  console.log(`Total species processed: ${stats.total}`);
  console.log(`✓ Successful: ${stats.success}`);
  console.log(`  - Links to add: ${stats.totalLinksAdded}`);
  console.log(`  - Images to add: ${stats.totalImagesAdded}`);
  console.log(`⊗ Not found in FishBase: ${stats.notFound}`);
  console.log(`⊙ Skipped (already synced): ${stats.skipped}`);
  console.log(`✗ Errors: ${stats.errors}`);

  // Show sample of what will be updated
  const needsUpdate = results.filter(r => r.status === 'success' && (r.new_links > 0 || r.new_images > 0));
  if (needsUpdate.length > 0) {
    console.log('\n=== Sample Updates (first 10) ===\n');
    needsUpdate.slice(0, 10).forEach(r => {
      console.log(`  ${r.scientific_name}`);
      if (r.new_links > 0) {
        console.log(`    Link: ${r.fishbase_url}`);
      }
      if (r.new_images > 0) {
        console.log(`    Images: ${r.image_urls.slice(0, 2).join(', ')}${r.image_urls.length > 2 ? ` +${r.image_urls.length - 2} more` : ''}`);
      }
    });
    if (needsUpdate.length > 10) {
      console.log(`  ... and ${needsUpdate.length - 10} more`);
    }
  }

  // Execute updates if requested
  if (execute && needsUpdate.length > 0) {
    console.log('\n=== Executing Sync ===\n');

    let appliedCount = 0;
    for (const result of needsUpdate) {
      try {
        await applySync(sqlite, result);
        appliedCount++;
        if (appliedCount % 50 === 0) {
          console.log(`  Applied ${appliedCount}/${needsUpdate.length} updates...`);
        }
      } catch (error: any) {
        console.error(`  ✗ Failed to apply update for ${result.scientific_name}: ${error.message}`);
      }
    }

    console.log(`\n✅ Successfully synced ${appliedCount} species with FishBase data!`);
  } else if (!execute && needsUpdate.length > 0) {
    console.log('\n💡 To execute this sync, run:');
    console.log('   npm run script scripts/sync-fishbase-external-data-duckdb.ts -- --execute');
  } else if (needsUpdate.length === 0) {
    console.log('\n✅ No updates needed (all species already have FishBase data)');
  }

  await sqlite.close();
  console.log('');
}

main().catch(error => {
  console.error('\n❌ Script failed:', error);
  process.exit(1);
});
